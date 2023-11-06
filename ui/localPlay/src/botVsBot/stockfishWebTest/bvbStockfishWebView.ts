import { Chessground } from 'chessground';
import { h, VNode } from 'snabbdom';
import { makeBvbConfig as makeCgConfig } from '../bvbChessground';
import * as Chops from 'chessops';
import { onInsert, bind } from 'common/snabbdom';
import { rangeConfig } from 'common/controls';
import { hasFeature } from 'common/device';
import { BvbStockfishWebCtrl } from './bvbStockfishWebCtrl';

const searchTicks: [number, string][] = [
  [100, '100ms'],
  [200, '200ms'],
  [400, '400ms'],
  [600, '600ms'],
  [800, '800ms'],
  [1000, '1s'],
  [3000, '3s'],
  [5000, '5s'],
  [10000, '10s'],
];

export default function render(ctrl: BvbStockfishWebCtrl): VNode {
  return h('div#local-play', [
    h('div.puz-board.main-board', [chessground(ctrl)]),
    h('div.puz-side', [
      results(ctrl),
      h('hr'),
      h('div', bot(ctrl, 'black')),
      h('div.spacer'),
      startingFen(ctrl),
      renderSettings(ctrl),
      h('hr'),
      controls(ctrl),
      h('div.spacer'),
      h('div', [bot(ctrl, 'white')]),
    ]),
  ]);
}
function startingFen(ctrl: BvbStockfishWebCtrl): VNode {
  return h('input.starting-fen', {
    attrs: { placeholder: Chops.fen.INITIAL_BOARD_FEN, spellcheck: 'false' },
    hook: bind('input', e => {
      const el = e.target as HTMLInputElement;
      if (!el.value) {
        console.log('wiping', ctrl.params.startingFen);
        ctrl.params.startingFen = '';
        ctrl.storeParams();
        return;
      }
      const text = Chops.fen.parseFen(el.value);
      if (text.isOk) {
        el.style.backgroundColor = '';
        ctrl.params.startingFen = el.value;
        ctrl.storeParams();
        ctrl.redraw();
      } else el.style.backgroundColor = 'red';
    }),
    props: {
      value: ctrl.params.startingFen,
    },
  });
}
function chessground(ctrl: BvbStockfishWebCtrl): VNode {
  return h('div.cg-wrap', {
    hook: {
      insert: vnode => (ctrl.cg = Chessground(vnode.elm as HTMLElement, makeCgConfig(ctrl))),
    },
  });
}

function bot(ctrl: BvbStockfishWebCtrl, color: Color): VNode {
  return h(`div.${color}.puz-bot`, [engineSelection(ctrl, color), h('span.totals', ctrl.resultsText(color))]);
}

function controls(ctrl: BvbStockfishWebCtrl) {
  return h('span', [
    h('input#num-games', {
      attrs: { type: 'number', min: '1', max: '1000', value: '1' },
    }),
    h(
      'button#go.button',
      {
        hook: onInsert(el =>
          el.addEventListener('click', () => ctrl.go(parseInt($('#num-games').val() as string) || 1)),
        ),
      },
      'GO',
    ),
  ]);
}

function results(ctrl: BvbStockfishWebCtrl) {
  return h('span', [
    h(
      'button#results.button-link',
      {
        hook: onInsert(el => el.addEventListener('click', () => downloadResults(ctrl))),
      },
      'Download results',
    ),
    h(
      'button#clear.button-link',
      {
        hook: onInsert(el => el.addEventListener('click', () => clearResults(ctrl))),
      },
      'Clear results',
    ),
  ]);
}
async function downloadResults(ctrl: BvbStockfishWebCtrl) {
  const results = [];
  for (const key of await ctrl.results.list()) {
    const result = await ctrl.results.get(key);
    results.push(result);
    console.log(result);
  }

  const blob = new Blob([JSON.stringify(results)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'results.json';
  a.click();
  URL.revokeObjectURL(url);
}

function clearResults(ctrl: BvbStockfishWebCtrl) {
  if (!confirm('Clear all results?')) return;
  ctrl.results.clear();
  ctrl.totals.white = ctrl.totals.black = ctrl.totals.draw = 0;
  ctrl.redraw();
}
const formatHashSize = (v: number): string => (v < 1000 ? v + 'MB' : Math.round(v / 1024) + 'GB');

function renderSettings(ctrl: BvbStockfishWebCtrl): VNode | null {
  const noarg = (text: string) => text,
    engCtrl = ctrl.engines;

  function searchTick() {
    return Math.max(
      0,
      searchTicks.findIndex(([tickMs]) => tickMs >= ctrl.params.movetime),
    );
  }

  return h('div.bot-settings', [
    (id => {
      return h('div.setting', [
        h('label', 'Move time'),
        h('input#' + id, {
          attrs: { type: 'range', min: 0, max: searchTicks.length - 1, step: 1 },
          hook: rangeConfig(searchTick, n => {
            ctrl.params.movetime = searchTicks[n][0];
            ctrl.storeParams();
            ctrl.redraw();
          }),
        }),
        h('div.range_value', searchTicks[searchTick()][1]),
      ]);
    })('engine-search-ms'),
    (id => {
      return h('div.setting', [
        h('label', 'N-fold draw'),
        h('input#' + id, {
          attrs: { type: 'range', min: 0, max: 12, step: 3 },
          hook: rangeConfig(
            () => ctrl.params.nfold,
            x => {
              ctrl.params.nfold = x;
              ctrl.storeParams();
              ctrl.redraw();
            },
          ),
        }),
        h('div.range_value', ctrl.params.nfold === 0 ? 'no draw' : `${ctrl.params.nfold} moves`),
      ]);
    })('draw-after'),
    hasFeature('sharedMem')
      ? (id => {
          return h('div.setting', [
            h('label', { attrs: { for: id } }, noarg('Threads')),
            h('input#' + id, {
              attrs: {
                type: 'range',
                min: 1,
                max: navigator.hardwareConcurrency,
                step: 1,
              },
              hook: rangeConfig(
                () => Math.min(ctrl.params.threads, navigator.hardwareConcurrency),
                x => {
                  ctrl.params.threads = x;
                  ctrl.storeParams();
                  ctrl.redraw();
                },
              ),
            }),
            h('div.range_value', `${ctrl.params.threads} / ${navigator.hardwareConcurrency}`),
          ]);
        })('analyse-threads')
      : null,
    (id =>
      h('div.setting', [
        h('label', { attrs: { for: id } }, noarg('Memory')),
        h('input#' + id, {
          attrs: {
            type: 'range',
            min: 4,
            max: Math.floor(Math.log2(engCtrl.active?.maxHash ?? 4)),
            step: 1,
          },
          hook: rangeConfig(
            () => {
              return Math.floor(Math.log2(ctrl.params.hash));
            },
            v => {
              ctrl.params.hash = Math.pow(2, v);
              ctrl.storeParams();
              ctrl.redraw();
            },
          ),
        }),
        h('div.range_value', formatHashSize(ctrl.params.hash)),
      ]))('analyse-memory'),
  ]);
}

function engineSelection(ctrl: BvbStockfishWebCtrl, color: Color): VNode {
  const engines = ctrl.engines.supporting('standard');
  return h(
    'select.select-engine',
    {
      hook: bind('change', e => {
        if (ctrl.ids[color] === (e.target as HTMLSelectElement).value) return;
        ctrl.totals = { gamesLeft: ctrl.totals?.gamesLeft ?? 1, white: 0, black: 0, draw: 0, error: 0 };
        ctrl.ids[color] = (e.target as HTMLSelectElement).value;
        ctrl.storeParams();
        ctrl.redraw();
      }),
      props: {
        value: ctrl.ids[color],
      },
    },
    [
      ...engines.map(engine => {
        console.log(color, ctrl.ids[color], engine.id, engine.name);

        return h(
          'option',
          {
            attrs: {
              value: engine.id,
              selected: ctrl.ids[color] === engine.id,
            },
          },
          engine.name,
        );
      }),
    ],
  );
}
