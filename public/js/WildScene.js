// The wild battle screen. The server runs the fight; this scene only plays
// back what it is told (rounds, throws, the end), one animation at a time.
// The Throw Shackle / Run buttons are an HTML panel under the canvas.

import { captureChance } from '/shared/rules.js';
import { BattleBase, InfoBox, INK, speciesName } from './BattleBase.js';
import { $ } from './ui.js';

/** Where things stand (bottom-centre of each sprite). */
const POS = {
  trainer: { x: 30, y: 142 },
  a: { x: 78, y: 144 }, // the player's Mon
  b: { x: 184, y: 110 }, // the wild Mon
};

/** @typedef {import('/shared/mons.js').Mon} Mon */

export class WildScene extends BattleBase {
  constructor() {
    super('wild', 'battle-msg');
  }

  /**
   * @param {{ world: any, start: { wild: Mon, active: number, party: Mon[], shackles: number },
   *   colors: any, pending: [string, any][] }} data
   */
  init(data) {
    this.resetQueue();
    this.world = data.world;
    this.socket = data.world.socket;
    /** Our own copies, updated as the animations play. */
    this.wild = { ...data.start.wild };
    this.party = data.start.party.map((m) => ({ ...m }));
    this.active = data.start.active;
    this.shackles = data.start.shackles;
    this.colors = data.colors;
    this.pending = data.pending;
    this.ended = false; // the server said the battle is over
    this.throwing = false;
  }

  create() {
    this.createArena();
    this.trainer = this.addTrainer(POS.trainer.x, POS.trainer.y, this.colors, 'right');
    const mine = this.party[this.active];
    this.monA = this.addMon(mine.species, POS.a.x, POS.a.y, false);
    this.monB = this.addMon(this.wild.species, POS.b.x, POS.b.y, true);

    this.boxA = new InfoBox(this, 8, 8, 104);
    this.boxB = new InfoBox(this, 128, 8, 104);
    this.boxA.set(speciesName(mine.species), mine.hp, mine.maxHp);
    this.boxB.set(`Wild ${speciesName(this.wild.species)}`, this.wild.hp, this.wild.maxHp);
    this.dots = this.add.graphics();
    this.drawPartyDots();

    this.setupPanel();
    this.events.once('shutdown', () => {
      $('battle-panel').hidden = true;
      $('help').hidden = false;
      /** @type {HTMLButtonElement} */ ($('battle-throw')).onclick = null;
      /** @type {HTMLButtonElement} */ ($('battle-run')).onclick = null;
    });

    this.enqueue(() => this.playIntro());
    // Messages that arrived before this scene was ready.
    for (const [event, data] of this.pending.splice(0)) this.onNet(event, data);
    this.world.battleScene = this;
  }

  /** Little dots under the player's box: one per party Mon. */
  drawPartyDots() {
    this.dots.clear();
    this.party.forEach((m, i) => {
      const x = 14 + i * 9;
      this.dots.fillStyle(INK).fillCircle(x, 38, 3.5);
      this.dots.fillStyle(m.hp > 0 ? 0x3aa457 : 0x8a8f99).fillCircle(x, 38, 2.5);
      if (i === this.active) this.dots.fillStyle(0xffffff).fillCircle(x, 38, 1);
    });
  }

  /** @param {'a'|'b'} side */
  nameOf(side) {
    return side === 'a' ? speciesName(this.party[this.active].species) : `Wild ${speciesName(this.wild.species)}`;
  }

  /** @param {'a'|'b'} side @param {number} hp */
  onHp(side, hp) {
    if (side === 'b') {
      this.wild.hp = hp;
    } else {
      this.party[this.active].hp = hp;
      this.drawPartyDots();
    }
    this.updateButtons();
  }

  // ------------------------------------------------------------ HTML panel

  setupPanel() {
    $('battle-panel').hidden = false;
    $('help').hidden = true; // the panel sits where the controls hint is
    const throwBtn = /** @type {HTMLButtonElement} */ ($('battle-throw'));
    const runBtn = /** @type {HTMLButtonElement} */ ($('battle-run'));
    throwBtn.onclick = () => {
      if (throwBtn.disabled) return;
      this.throwing = true;
      this.updateButtons();
      this.socket.emit('throwShackle');
    };
    runBtn.onclick = () => {
      if (runBtn.disabled) return;
      this.ended = true;
      this.updateButtons();
      this.socket.emit('run');
    };
    this.updateButtons();
  }

  updateButtons() {
    const throwBtn = /** @type {HTMLButtonElement} */ ($('battle-throw'));
    const runBtn = /** @type {HTMLButtonElement} */ ($('battle-run'));
    const chance = Math.round(captureChance(this.wild) * 100);
    throwBtn.textContent = `Throw Shackle · ${chance}% (${this.shackles} left)`;
    throwBtn.disabled = this.ended || this.throwing || this.shackles < 1 || this.wild.hp <= 0;
    runBtn.disabled = this.ended;
  }

  // ------------------------------------------------------------ server messages

  /** @param {string} event @param {any} data */
  onNet(event, data) {
    if (event === 'wildRound') {
      this.enqueue(() => this.playRound(data));
    } else if (event === 'wildThrow') {
      this.shackles = data.shackles;
      this.enqueue(() => this.playThrow(data));
    } else if (event === 'wildEnd') {
      this.ended = true;
      this.updateButtons();
      this.enqueue(() => this.playEnd(data));
    }
  }

  // ------------------------------------------------------------ animations

  async playIntro() {
    this.monB.x += 90;
    this.trainer.x -= 90;
    this.monA.x -= 90;
    this.say(`A wild ${speciesName(this.wild.species)} appeared!`);
    await Promise.all([
      this.tween({ targets: this.monB, x: POS.b.x, duration: 450, ease: 'Quad.easeOut' }),
      this.tween({ targets: [this.trainer, this.monA], x: '+=90', duration: 450, ease: 'Quad.easeOut' }),
    ]);
    await this.wait(400);
    this.say(`Go, ${speciesName(this.party[this.active].species)}!`);
  }

  /** @param {{ events: any[], active: number }} round */
  async playRound(round) {
    for (const e of round.events) {
      if (e.type === 'attack') await this.playAttack(e);
      else await this.playFaint(e.side);
    }
    if (round.active !== this.active && this.wild.hp > 0 && this.party[round.active].hp > 0) {
      await this.switchTo(round.active);
    }
  }

  /** @param {number} index */
  async switchTo(index) {
    this.active = index;
    const mon = this.party[index];
    this.monA.setTexture(`mon-${mon.species}`).setPosition(POS.a.x - 70, POS.a.y).setAlpha(1);
    this.boxA.set(speciesName(mon.species), mon.hp, mon.maxHp);
    this.drawPartyDots();
    this.say(`Go, ${speciesName(mon.species)}!`);
    await this.tween({ targets: this.monA, x: POS.a.x, duration: 260, ease: 'Quad.easeOut' });
  }

  /** @param {{ success: boolean, chance: number }} t */
  async playThrow(t) {
    this.throwing = true;
    this.updateButtons();
    const name = speciesName(this.wild.species);
    this.say(`You throw a shackle! (${Math.round(t.chance * 100)}% chance)`);

    // Arc from the trainer's hand to the wild Mon.
    const shackle = this.add.image(POS.trainer.x + 10, POS.trainer.y - 26, 'shackle');
    const from = { x: shackle.x, y: shackle.y };
    const to = { x: POS.b.x, y: POS.b.y - 28 };
    const p = { t: 0 };
    await this.tween({
      targets: p, t: 1, duration: 450,
      onUpdate: () => {
        shackle.x = from.x + (to.x - from.x) * p.t;
        shackle.y = from.y + (to.y - from.y) * p.t - Math.sin(Math.PI * p.t) * 40;
        shackle.angle = p.t * 540;
      },
    });

    // The Mon is pulled into the shackle, which drops and wobbles.
    shackle.angle = 0;
    this.monB.setTintFill(0xffffff);
    await this.tween({ targets: this.monB, scaleX: 0, scaleY: 0, duration: 200 });
    await this.tween({ targets: shackle, y: POS.b.y - 8, duration: 220, ease: 'Bounce.easeOut' });
    const wobbles = t.success ? 3 : 1 + Math.floor(t.chance * 2.5);
    for (let i = 0; i < wobbles; i++) {
      await this.tween({ targets: shackle, angle: i % 2 ? -18 : 18, duration: 110, yoyo: true });
      await this.wait(90);
    }

    if (t.success) {
      this.sparkle(shackle.x, shackle.y);
      this.say(`Gotcha! ${name} was caught!`);
      await this.wait(500);
    } else {
      this.monB.clearTint();
      this.tween({ targets: shackle, alpha: 0, y: shackle.y - 8, angle: 90, duration: 250 }).then(() => shackle.destroy());
      await this.tween({ targets: this.monB, scaleX: 1.5, scaleY: 1.5, duration: 180, ease: 'Back.easeOut' });
      this.say(`Oh no! ${name} broke free!`);
      await this.wait(300);
    }
    this.throwing = false;
    this.updateButtons();
  }

  /** @param {{ result: 'won'|'caught'|'ran'|'lost', coins?: number, to?: string }} end */
  async playEnd(end) {
    const name = speciesName(this.wild.species);
    const text = {
      won: `You won! You got ${end.coins} coins.`,
      caught: `${name} ${end.to === 'party' ? 'joined your party' : 'was sent to storage (your party is full)'}.`,
      ran: 'You got away safely.',
      lost: 'All your Mons fainted... You hurry back to the hospital.',
    }[end.result];
    if (end.result === 'ran') {
      this.tween({ targets: [this.trainer, this.monA], x: '-=120', duration: 400, ease: 'Quad.easeIn' });
    }
    this.say(text);
    await this.wait(end.result === 'ran' ? 900 : 1700);
    this.cameras.main.fadeOut(250, 0, 0, 0);
    await this.wait(260);
    this.world.endBattle(end.result);
    this.scene.stop();
  }
}
