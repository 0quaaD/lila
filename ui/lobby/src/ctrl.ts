import { numberFormat } from 'common/number';
import variantConfirm from './variant';
import * as hookRepo from './hookRepo';
import * as seekRepo from './seekRepo';
import { make as makeStores, Stores } from './store';
import * as xhr from './xhr';
import * as poolRangeStorage from './poolRangeStorage';
import { LobbyOpts, LobbyData, Tab, Mode, Sort, Hook, Seek, Pool, PoolMember, LobbyMe } from './interfaces';
import { ParentCtrl, SetupConstraints, GameType, GameSetup, SetupCtrl } from 'setup';
import LobbySocket from './socket';
import Filter from './filter';

export default class LobbyController implements ParentCtrl {
  data: LobbyData;
  playban: any;
  me?: LobbyMe;
  socket: LobbySocket;
  stores: Stores;
  tab: Tab;
  mode: Mode;
  sort: Sort;
  stepHooks: Hook[] = [];
  stepping = false;
  redirecting = false;
  poolMember?: PoolMember;
  trans: Trans;
  pools: Pool[];
  filter: Filter;
  setupCtrl: SetupCtrl;

  private poolInStorage: LichessStorage;
  private flushHooksTimeout?: number;
  private alreadyWatching: string[] = [];

  constructor(
    readonly opts: LobbyOpts,
    readonly redraw: () => void,
  ) {
    this.data = opts.data;
    this.data.hooks = [];
    this.me = opts.data.me;
    this.pools = opts.pools;
    this.playban = opts.playban;
    this.filter = new Filter(site.storage.make('lobby.filter'), this);
    this.redraw = redraw;

    hookRepo.initAll(this);
    seekRepo.initAll(this);
    this.socket = new LobbySocket(opts.socketSend, this);

    this.stores = makeStores(this.me?.username.toLowerCase());
    if (!this.me?.isBot && this.stores.tab.get() == 'now_playing' && this.data.nbNowPlaying == 0) {
      this.stores.tab.set('pools');
    }
    this.tab = this.me?.isBot ? 'now_playing' : this.stores.tab.get();
    this.mode = this.stores.mode.get();
    this.sort = this.stores.sort.get();
    this.trans = opts.trans;

    const { gameType, forceOptions, friendUser } = this.parseUrlParams();
    if (gameType) this.showSetupModal(gameType, forceOptions, friendUser);
    history.replaceState(null, '', '/');

    this.poolInStorage = site.storage.make('lobby.pool-in');
    this.poolInStorage.listen(_ => {
      // when another tab joins a pool
      this.leavePool();
      redraw();
    });
    this.flushHooksSchedule();

    this.startWatching();

    if (this.playban) {
      if (this.playban.remainingSeconds < 86400)
        setTimeout(site.reload, this.playban.remainingSeconds * 1000);
    } else {
      setInterval(() => {
        if (this.poolMember) this.poolIn();
        else if (this.tab === 'real_time' && !this.data.hooks.length) this.socket.realTimeIn();
      }, 10 * 1000);
      this.joinPoolFromLocationHash();
    }

    site.pubsub.on('socket.open', () => {
      if (this.tab === 'real_time') {
        this.data.hooks = [];
        this.socket.realTimeIn();
      } else if (this.tab === 'pools' && this.poolMember) this.poolIn();
    });
    window.addEventListener('beforeunload', () => this.leavePool());
  }
  spreadPlayersNumber?: (nb: number) => void;
  spreadGamesNumber?: (nb: number) => void;
  initNumberSpreader = (elm: HTMLAnchorElement, nbSteps: number, initialCount: number) => {
    let previous = initialCount;
    let timeouts: number[] = [];
    const display = (prev: number, cur: number, it: number) => {
      elm.textContent = numberFormat(Math.round((prev * (nbSteps - 1 - it) + cur * (it + 1)) / nbSteps));
    };
    return (nb: number) => {
      if (!nb && nb !== 0) return;
      timeouts.forEach(clearTimeout);
      timeouts = [];
      const interv = Math.abs(site.socket.pingInterval() / nbSteps);
      const prev = previous || nb;
      previous = nb;
      for (let i = 0; i < nbSteps; i++)
        timeouts.push(setTimeout(() => display(prev, nb, i), Math.round(i * interv)));
    };
  };

  private doFlushHooks() {
    this.stepHooks = this.data.hooks.slice(0);
    if (this.tab === 'real_time') this.redraw();
  }

  flushHooks = (now: boolean) => {
    if (this.flushHooksTimeout) clearTimeout(this.flushHooksTimeout);
    if (now) this.doFlushHooks();
    else {
      this.stepping = true;
      if (this.tab === 'real_time') this.redraw();
      setTimeout(() => {
        this.stepping = false;
        this.doFlushHooks();
      }, 500);
    }
    this.flushHooksTimeout = this.flushHooksSchedule();
  };

  private flushHooksSchedule = (): number => setTimeout(this.flushHooks, 8000);

  setTab = (tab: Tab) => {
    if (tab !== this.tab) {
      if (tab === 'seeks') xhr.seeks().then(this.setSeeks);
      else if (tab === 'real_time') this.socket.realTimeIn();
      else if (this.tab === 'real_time') {
        this.socket.realTimeOut();
        this.data.hooks = [];
      }
      this.tab = this.stores.tab.set(tab);
    }
    this.filter.open = false;
  };

  setMode = (mode: Mode) => {
    this.mode = this.stores.mode.set(mode);
    this.filter.open = false;
  };

  setSort = (sort: Sort) => {
    this.sort = this.stores.sort.set(sort);
  };

  onSetFilter = () => {
    this.flushHooks(true);
    if (this.tab !== 'real_time') this.redraw();
  };

  clickHook = (id: string) => {
    const hook = hookRepo.find(this, id);
    if (!hook || hook.disabled || this.stepping || this.redirecting) return;
    if (hook.action === 'cancel' || variantConfirm(hook.variant)) this.socket.send(hook.action, hook.id);
  };

  clickSeek = (id: string) => {
    const seek = seekRepo.find(this, id);
    if (!seek || this.redirecting) return;
    if (seek.action === 'cancelSeek' || variantConfirm(seek.variant)) this.socket.send(seek.action, seek.id);
  };

  setSeeks = (seeks: Seek[]) => {
    this.data.seeks = seeks;
    seekRepo.initAll(this);
    this.redraw();
  };

  clickPool = (id: string) => {
    if (!this.me) {
      xhr.anonPoolSeek(this.pools.find(p => p.id == id)!);
      this.setTab('real_time');
    } else if (this.poolMember && this.poolMember.id === id) this.leavePool();
    else this.enterPool({ id });
    this.redraw();
  };

  enterPool = (member: PoolMember) => {
    poolRangeStorage.set(this.me, member);
    this.setTab('pools');
    this.poolMember = member;
    this.poolIn();
  };

  leavePool = () => {
    if (!this.poolMember) return;
    this.socket.poolOut(this.poolMember);
    this.poolMember = undefined;
  };

  poolIn = () => {
    if (!this.poolMember) return;
    this.poolInStorage.fire();
    this.socket.poolIn(this.poolMember);
  };

  acquire = ({ id, gameType, color, variant, timeMode, gameMode, range }: GameSetup) => {
    const pool =
      color == 'random' &&
      gameType === 'hook' &&
      variant == 'standard' &&
      gameMode == 'rated' &&
      timeMode == 'realTime' &&
      this.pools.find(p => p.id === id)
        ? {
            id,
            range: range,
          }
        : null;
    if (!pool && gameType === 'hook') this.setTab(timeMode === 'realTime' ? 'real_time' : 'seeks');
    if (pool) this.enterPool(pool);
    return pool !== null;
  };

  hasOngoingRealTimeGame = () =>
    !!this.data.nowPlaying.find(nowPlaying => nowPlaying.isMyTurn && nowPlaying.speed !== 'correspondence');

  gameActivity = (gameId: string) => {
    if (this.data.nowPlaying.find(p => p.gameId === gameId))
      xhr.nowPlaying().then(povs => {
        this.data.nowPlaying = povs;
        this.startWatching();
        this.redraw();
      });
  };

  private startWatching() {
    const newIds = this.data.nowPlaying.map(p => p.gameId).filter(id => !this.alreadyWatching.includes(id));
    if (newIds.length) {
      setTimeout(() => this.socket.send('startWatching', newIds.join(' ')), 2000);
      newIds.forEach(id => this.alreadyWatching.push(id));
    }
  }

  setRedirecting = () => {
    this.redirecting = true;
    setTimeout(() => {
      this.redirecting = false;
      this.redraw();
    }, 4000);
    this.redraw();
  };

  awake = () => {
    switch (this.tab) {
      case 'real_time':
        this.data.hooks = [];
        this.socket.realTimeIn();
        break;
      case 'seeks':
        xhr.seeks().then(this.setSeeks);
        break;
    }
  };

  get user() {
    return this.me?.username.toLowerCase();
  }

  get ratingMap() {
    return this.data.ratingMap ? this.data.ratingMap : undefined;
  }

  hasPool = (id: string) => this.pools.some(p => p.id === id);

  showSetupModal = async (gameType: GameType, opts?: SetupConstraints, friendUser?: string) => {
    if (!this.setupCtrl) this.setupCtrl = await site.asset.loadEsm<SetupCtrl>('setup', { init: this });
    this.leavePool();
    this.setupCtrl.openModal(gameType, opts, friendUser);
    this.redraw();
  };

  private parseUrlParams = () => {
    const locationHash = location.hash.replace('#', '');
    if (!['ai', 'friend', 'hook', 'local'].includes(locationHash)) return {};

    const gameType = locationHash as GameType;
    let friendUser: string | undefined;
    const forceOptions: SetupConstraints = {};
    const urlParams = new URLSearchParams(location.search);
    if (locationHash === 'hook') {
      if (urlParams.get('time') === 'realTime') {
        this.tab = 'real_time';
        forceOptions.timeMode = 'realTime';
      } else if (urlParams.get('time') === 'correspondence') {
        this.tab = 'seeks';
        forceOptions.timeMode = 'correspondence';
      }
    } else if (urlParams.get('fen')) {
      forceOptions.fen = urlParams.get('fen')!;
      forceOptions.variant = 'fromPosition';
    } else {
      friendUser = urlParams.get('user')!;
    }
    return { gameType, forceOptions, friendUser };
  };

  // after click on round "new opponent" button
  // also handles onboardink link for anon users
  private joinPoolFromLocationHash = () => {
    if (location.hash.startsWith('#pool/')) {
      const regex = /^#pool\/(\d+\+\d+)(?:\/(.+))?$/,
        match = regex.exec(location.hash),
        member: any = { id: match![1], blocking: match![2] },
        range = poolRangeStorage.get(this.me, member.id);
      if (range) member.range = range;
      if (match) {
        this.setTab('pools');
        if (this.me) this.enterPool(member);
        else setTimeout(() => this.clickPool(member.id), 1500);
        history.replaceState(null, '', '/');
      }
    }
  };
}
