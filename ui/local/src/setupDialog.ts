import type { Libot, Libots, LocalSetup } from './types';
import { isTouchDevice } from 'common/device';
import { HandOfCards } from './handOfCards';
//import { clamp } from 'common';
import * as licon from 'common/licon';
import { defined } from 'common';
//import { ratingView } from './components/ratingView';

export class LocalDialog {
  view: HTMLElement;
  white: HTMLElement;
  black: HTMLElement;
  setup: LocalSetup = {};
  hand: HandOfCards;

  constructor(
    readonly bots: Libots,
    setup: LocalSetup = {},
    readonly noClose = false,
  ) {
    this.setup = { ...setup };
    const player = (color: 'white' | 'black') =>
      `<div class="player ${color}"><img class="remove" src="${site.asset.flairSrc(
        'symbols.cancel',
      )}"><div class="placard ${color}">Player</div></div>`;
    this.view = $as<HTMLElement>(`<div class="with-hand-of-cards">
      <div class="vs">
        ${player('white')}
        <div class="actions">
          <button class="button button-empty switch" data-icon="${licon.Switch}"></button>
          <button class="button button-empty random" data-icon="${licon.DieSix}"></button>
          <button class="button button-empty fight" data-icon="${licon.Swords}"></button>
        </div>
        ${player('black')}
      </div>
    </div>`);
    this.white = this.view.querySelector('.white')!;
    this.black = this.view.querySelector('.black')!;
    const cardData = [...Object.values(this.bots).map(b => b.card)].filter(defined);
    //const drops = ;
    this.hand = new HandOfCards({
      view: () => this.view,
      drops: () => [
        { el: this.white, selected: this.setup.white },
        { el: this.black, selected: this.setup.black },
      ],
      cardData: () => cardData,
      select: this.dropSelect,
    });
    this.show();
  }

  show() {
    site.dialog
      .dom({
        class: 'game-setup.local-setup',
        css: [{ hashed: 'local.setup' }],
        htmlText: `<div class="chin">
            <input type="checkbox" id="bot-dev" checked>
            <label for="bot-dev">Dev UI</label>
          </div>`,
        append: [{ node: this.view, where: '.chin', how: 'before' }],
        action: [
          { selector: '.fight', result: dlg => this.fight(dlg) },
          { selector: '.switch', result: dlg => this.switch(dlg) },
          { selector: '.random', result: dlg => this.random(dlg) },
          { selector: '.white > img.remove', result: () => this.select('white') },
          { selector: '.black > img.remove', result: () => this.select('black') },
        ],
        noCloseButton: this.noClose,
        noClickAway: this.noClose,
      })
      .then(dlg => {
        if (this.setup.white) this.select('white', this.setup.white);
        if (this.setup.black) this.select('black', this.setup.black);
        dlg.showModal();
        this.hand.resize();
      });
  }

  dropSelect = (target: HTMLElement, domId?: string) => {
    const color = target.classList.contains('white') ? 'white' : 'black';
    this.select(color, domId ? `#${domId}` : undefined);
  };

  select(color: 'white' | 'black', selection?: string) {
    const bot = selection ? this.bots[selection] : undefined;
    this.view.querySelector(`.${color} .placard`)!.textContent = bot ? bot.description : 'Player';
    this.setup[color] = bot?.uid;
    if (!bot) this.hand.redraw();
    this[color].querySelector(`img.remove`)?.classList.toggle('show', !!bot);
  }

  fight = async (dlg: Dialog) => {
    this.setup.time = 'unlimited';
    this.setup.go = true;
    const form = $as<HTMLFormElement>(
      `<form method="POST" action="/local?testUi=${$as<HTMLInputElement>('#bot-dev').checked}">`,
    );
    for (const [k, v] of Object.entries(this.setup)) {
      form.appendChild($as<HTMLInputElement>(`<input name="${k}" type="hidden" value="${v}">`));
    }
    document.body.appendChild(form);
    form.submit();
    form.remove();
  };

  switch = (dlg: Dialog) => {
    const newBlack = this.setup.white;
    this.select('white', this.setup.black);
    this.select('black', newBlack);
    this.hand.redraw();
  };

  random = (dlg: Dialog) => {
    if (Math.random() < 0.5) this.switch(dlg);
    this.fight(dlg);
  };
}
