import { attributesModule, classModule, init } from 'snabbdom';
import { RoundOpts, RoundData } from 'round';
import { Ctrl as LocalPlayCtrl } from './ctrl';
import view from './view';
import initBvb from '../src-test/main';
import { LocalPlayOpts } from './interfaces';
import { fakeData as data } from './data';

const patch = init([classModule, attributesModule]);

export async function initModule(opts: LocalPlayOpts) {
  if (opts.mode === 'botVsBot') return initBvb(opts);

  const ctrl = new LocalPlayCtrl(opts, () => {});
  ctrl.tellRound = await makeRound(ctrl);
  await ctrl.loaded;
  console.log('done', ctrl.libot, ctrl.libot.bots);
  const blueprint = view(ctrl);
  const element = document.querySelector('#bot-view') as HTMLElement;
  element.innerHTML = '';
  let vnode = patch(element, blueprint);

  function redraw() {
    vnode = patch(vnode, view(ctrl));
  }
  redraw();
}

export async function makeRound(ctrl: LocalPlayCtrl): Promise<SocketSend> {
  const moves: string[] = [];
  console.log(ctrl.dests);
  for (const from in ctrl.dests) {
    moves.push(from + ctrl.dests[from]);
  }
  const opts: RoundOpts = {
    element: document.querySelector('.round__app') as HTMLElement,
    data: { ...data, possibleMoves: moves.join(' ') },
    socketSend: (t: string, d: any) => {
      if (t === 'move') {
        console.log('movin on up', t, d);
        ctrl.userMove(d.u);
      }
    },
    crosstableEl: document.querySelector('.cross-table') as HTMLElement,
    i18n: {},
    onChange: (d: RoundData) => console.log(d),
    local: true,
  };
  return lichess.loadEsm('round', { init: opts });
}
