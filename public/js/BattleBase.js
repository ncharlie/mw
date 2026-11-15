// What the wild battle screen and the PvP replay share: the arena, HP boxes,
// and the attack / faint animations. Side 'a' is always on the left (the
// player watching), side 'b' on the right.
//
// Animations run one after another: enqueue() chains them on a promise, so
// messages from the server can arrive at any time without overlapping.

import { SPECIES } from '/shared/mons.js';
import { characterTexture, characterFrame } from './art.js';
import { monCanvas, shackleCanvas } from './monArt.js';
import { $ } from './ui.js';
import { ZOOM } from './WorldScene.js';

/** The battle screen is the same size as the world view: 240 x 176 art pixels. */
export const W = 240;
export const H = 176;
export const INK = 0x2b2a33;
export const TEXT = { fontFamily: 'monospace', fontStyle: 'bold', color: '#22202a', resolution: ZOOM };

/** @param {string} species */
export const speciesName = (species) => SPECIES[/** @type {import('/shared/mons.js').SpeciesId} */ (species)].name;

/** Name, HP numbers and HP bar for one Mon. */
export class InfoBox {
  /** @param {Phaser.Scene} scene @param {number} x @param {number} y @param {number} w */
  constructor(scene, x, y, w) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.w = w;
    this.hp = 0;
    this.maxHp = 1;
    scene.add.graphics()
      .fillStyle(0xf7f3e6).fillRoundedRect(x, y, w, 24, 3)
      .lineStyle(1, INK).strokeRoundedRect(x + 0.5, y + 0.5, w - 1, 23, 3);
    this.label = scene.add.text(x + 5, y + 3, '', { ...TEXT, fontSize: '7px' });
    this.hpText = scene.add.text(x + w - 5, y + 4, '', { ...TEXT, fontSize: '6px' }).setOrigin(1, 0);
    this.bar = scene.add.graphics();
  }

  /** @param {string} label @param {number} hp @param {number} maxHp */
  set(label, hp, maxHp) {
    this.label.setText(label);
    this.maxHp = maxHp;
    this.draw(hp);
  }

  /** @param {number} hp */
  draw(hp) {
    this.hp = hp;
    const ratio = Math.max(0, hp / this.maxHp);
    const bx = this.x + 5;
    const by = this.y + 15;
    const bw = this.w - 10;
    const color = ratio > 0.5 ? 0x3aa457 : ratio > 0.2 ? 0xe0b030 : 0xd9573f;
    this.bar.clear()
      .fillStyle(INK).fillRect(bx - 1, by - 1, bw + 2, 6)
      .fillStyle(0x5a5a66).fillRect(bx, by, bw, 4)
      .fillStyle(color).fillRect(bx, by, Math.round(bw * ratio), 4);
    this.hpText.setText(`${Math.round(hp)}/${this.maxHp}`);
  }

  /** Slide the bar to a new value. @param {number} to */
  animateTo(to) {
    const counter = { v: this.hp };
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: counter, v: to, duration: 180,
        onUpdate: () => this.draw(counter.v),
        onComplete: () => { this.draw(to); resolve(undefined); },
      });
    });
  }
}

export class BattleBase extends Phaser.Scene {
  /** @param {string} key @param {string} msgId the HTML element that shows battle messages */
  constructor(key, msgId) {
    super(key);
    this.msgId = msgId;
  }

  /** Call from init(). */
  resetQueue() {
    this.alive = true;
    /** @type {Promise<void>} */
    this.chain = Promise.resolve();
  }

  /** Call first in create(). */
  createArena() {
    for (const id of Object.keys(SPECIES)) {
      if (!this.textures.exists(`mon-${id}`)) this.textures.addCanvas(`mon-${id}`, monCanvas(/** @type {any} */ (id)));
    }
    if (!this.textures.exists('shackle')) this.textures.addCanvas('shackle', shackleCanvas());
    this.cameras.main.setZoom(ZOOM).centerOn(W / 2, H / 2);
    this.events.once('shutdown', () => {
      this.alive = false;
    });

    const g = this.add.graphics();
    g.fillStyle(0xa8dcff).fillRect(0, 0, W, 50);
    g.fillStyle(0xc4e8ff).fillRect(0, 50, W, 50);
    g.fillStyle(0x9ed38a).fillEllipse(50, 96, 190, 50).fillEllipse(205, 98, 200, 44);
    g.fillStyle(0x8fd16a).fillRect(0, 92, W, H - 92);
    g.fillStyle(0x78bb57); // a few grass tufts, always in the same places
    for (let i = 0; i < 40; i++) g.fillRect((i * 53) % W, 96 + ((i * 37) % (H - 100)), 2, 1);
    // the two platforms: near-left for the player's side, far-right for the other side
    g.fillStyle(0x6fb455).fillEllipse(68, 142, 110, 22);
    g.fillStyle(0x5ea347).fillEllipse(68, 144, 96, 14);
    g.fillStyle(0x6fb455).fillEllipse(186, 108, 92, 18);
    g.fillStyle(0x5ea347).fillEllipse(186, 110, 78, 11);
  }

  /**
   * A trainer standing at (x, y) (bottom-centre), drawn at 2x.
   * @param {number} x @param {number} y
   * @param {Parameters<typeof characterTexture>[1]} colors
   * @param {'left'|'right'} facing
   */
  addTrainer(x, y, colors, facing) {
    const f = characterFrame(facing, 0);
    return this.add.sprite(x, y, characterTexture(this, colors), f.frame)
      .setOrigin(0.5, 1).setScale(2).setFlipX(f.flipX);
  }

  /** @param {string} species @param {number} x @param {number} y @param {boolean} faceLeft */
  addMon(species, x, y, faceLeft) {
    return this.add.image(x, y, `mon-${species}`).setOrigin(0.5, 1).setScale(1.5).setFlipX(faceLeft);
  }

  /** @param {string} text */
  say(text) {
    $(this.msgId).textContent = text;
  }

  /** Run `fn` after everything already queued. @param {() => Promise<void> | void} fn */
  enqueue(fn) {
    this.chain = this.chain
      .then(() => (this.alive ? fn() : undefined))
      .catch((err) => console.error(err));
  }

  /** @param {number} ms */
  wait(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /** A tween as a promise. @param {Phaser.Types.Tweens.TweenBuilderConfig} config */
  tween(config) {
    return new Promise((resolve) => this.tweens.add({ ...config, onComplete: () => resolve(undefined) }));
  }

  // ------------------------------------------------------------ hooks for subclasses

  /** Display name of the Mon fighting on a side. @param {'a'|'b'} _side @returns {string} */
  nameOf(_side) {
    return '';
  }

  /** A Mon's HP changed (after the bar animation). @param {'a'|'b'} _side @param {number} _hp */
  onHp(_side, _hp) {}

  // ------------------------------------------------------------ shared animations
  // These need this.monA / this.monB (images) and this.boxA / this.boxB (InfoBoxes).

  /**
   * One attack, or several summed into one turn (`hits` > 1, in match replays).
   * @param {{ by: 'a'|'b', damage: number, strong: boolean, hp: number, hits?: number }} e
   */
  async playAttack(e) {
    const left = e.by === 'a';
    const attacker = left ? this.monA : this.monB;
    const target = left ? this.monB : this.monA;
    const times = e.hits && e.hits > 1 ? ` ${e.hits} times` : '';
    this.say(`${this.nameOf(e.by)} attacks${times}!${e.strong ? " It's strong!" : ''}`);
    await this.tween({ targets: attacker, x: attacker.x + (left ? 10 : -10), duration: 70, yoyo: true });
    this.tweens.add({ targets: target, alpha: 0.25, duration: 50, yoyo: true, repeat: 1 });
    this.popDamage(target, e.damage, e.strong);
    await (left ? this.boxB : this.boxA).animateTo(e.hp);
    this.onHp(left ? 'b' : 'a', e.hp);
  }

  /** @param {'a'|'b'} side */
  async playFaint(side) {
    const sprite = side === 'a' ? this.monA : this.monB;
    this.say(`${this.nameOf(side)} fainted!`);
    this.onHp(side, 0);
    await this.tween({ targets: sprite, y: sprite.y + 14, alpha: 0, duration: 350 });
    await this.wait(250);
  }

  /** Floating damage number. */
  popDamage(target, damage, strong) {
    const text = this.add.text(target.x, target.y - target.displayHeight, `-${damage}`, {
      ...TEXT, fontSize: strong ? '9px' : '7px', color: strong ? '#ffd23f' : '#ffffff', stroke: '#22202a', strokeThickness: 2,
    }).setOrigin(0.5, 1);
    this.tweens.add({
      targets: text, y: text.y - 12, alpha: 0, duration: 600, ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  /** Little stars flying out of a point. */
  sparkle(x, y, color = '#ffd23f') {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const star = this.add.text(x, y, '✦', { ...TEXT, fontSize: '7px', color }).setOrigin(0.5);
      this.tweens.add({
        targets: star, x: x + Math.cos(angle) * 16, y: y + Math.sin(angle) * 12, alpha: 0, duration: 600,
        onComplete: () => star.destroy(),
      });
    }
  }
}
