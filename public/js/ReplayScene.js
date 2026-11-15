// Plays back a PvP or bot match. The server already simulated the whole match;
// both players get the same event log and watch it here, pair by pair, with a
// running score. No input during the fight, except speed-up and skip.
//
// Each pair plays its `turns` (at most PVP_MAX_TURNS, long fights summed up)
// and the pauses below are sized so a pair, from entering to leaving, takes
// under 5 seconds at normal speed.

import { BattleBase, InfoBox, speciesName, TEXT, W } from './BattleBase.js';
import { colorsForName, BOT_COLORS } from './art.js';
import { showResult } from './pvpMenus.js';
import { $ } from './ui.js';

/** The watching player is always on the left. */
const POS = {
  trainerA: { x: 28, y: 142 },
  a: { x: 78, y: 144 },
  b: { x: 176, y: 110 },
  trainerB: { x: 220, y: 106 },
};
const SPEEDS = [1, 3];

/**
 * @typedef {object} MatchResult the server's 'pvpResult' message
 * @property {'a'|'b'} you
 * @property {{a: string, b: string}} names
 * @property {boolean} bot
 * @property {{ a: any, b: any, rounds: any[][], turns: any[][], winner: 'a'|'b' }[]} pairs
 * @property {{a: number, b: number}} score
 * @property {'a'|'b'|'draw'} winner
 * @property {number} wins
 */

export class ReplayScene extends BattleBase {
  constructor() {
    super('replay', 'replay-msg');
  }

  /** @param {{ world: any, result: MatchResult }} data */
  init(data) {
    this.resetQueue();
    this.world = data.world;
    this.result = data.result;
    /** Simulation side of the watching player, and of the opponent. */
    this.me = data.result.you;
    this.them = this.me === 'a' ? 'b' : 'a';
    this.myName = data.result.names[this.me];
    this.theirName = data.result.names[this.them];
    this.score = { me: 0, them: 0 };
    /** The two Mons in the current pair, by screen side. */
    this.current = { a: /** @type {any} */ (null), b: /** @type {any} */ (null) };
    this.finished = false;
    this.speedIndex = 0;
  }

  create() {
    this.createArena();
    const theirColors = this.result.bot ? BOT_COLORS : colorsForName(this.theirName);
    this.trainerA = this.addTrainer(POS.trainerA.x, POS.trainerA.y, colorsForName(this.myName), 'right');
    this.trainerB = this.addTrainer(POS.trainerB.x, POS.trainerB.y, theirColors, 'left');
    this.monA = this.addMon('cat', POS.a.x, POS.a.y, false).setAlpha(0);
    this.monB = this.addMon('cat', POS.b.x, POS.b.y, true).setAlpha(0);
    this.boxA = new InfoBox(this, 8, 8, 104);
    this.boxB = new InfoBox(this, 128, 8, 104);
    this.boxA.set(this.myName, 1, 1);
    this.boxB.set(this.theirName, 1, 1);

    const scoreStyle = { ...TEXT, stroke: '#ffffff', strokeThickness: 2 };
    this.scoreText = this.add.text(W / 2, 38, '', { ...scoreStyle, fontSize: '9px' }).setOrigin(0.5, 0);
    this.pairText = this.add.text(W / 2, 51, '', { ...scoreStyle, fontSize: '6px' }).setOrigin(0.5, 0);
    this.updateScore();

    this.setupPanel();
    this.events.once('shutdown', () => {
      $('replay-panel').hidden = true;
      $('help').hidden = false;
      /** @type {HTMLButtonElement} */ ($('replay-speed')).onclick = null;
      /** @type {HTMLButtonElement} */ ($('replay-skip')).onclick = null;
    });
    this.enqueue(() => this.play());
  }

  setupPanel() {
    $('replay-panel').hidden = false;
    $('help').hidden = true;
    const speedBtn = /** @type {HTMLButtonElement} */ ($('replay-speed'));
    const skipBtn = /** @type {HTMLButtonElement} */ ($('replay-skip'));
    speedBtn.disabled = false;
    skipBtn.disabled = false;
    speedBtn.textContent = 'Speed ×1';
    speedBtn.onclick = () => {
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
      const speed = SPEEDS[this.speedIndex];
      this.tweens.timeScale = speed;
      this.time.timeScale = speed;
      speedBtn.textContent = `Speed ×${speed}`;
      speedBtn.blur();
    };
    skipBtn.onclick = () => {
      skipBtn.blur();
      this.finish();
    };
  }

  /** @param {'a'|'b'} side screen side */
  nameOf(side) {
    const mon = this.current[side];
    return side === 'a' ? `Your ${speciesName(mon.species)}` : `${this.theirName}'s ${speciesName(mon.species)}`;
  }

  updateScore() {
    this.scoreText.setText(`${this.myName} ${this.score.me} – ${this.score.them} ${this.theirName}`);
  }

  /** Simulation side ('a'/'b' in the log) -> screen side (mine is always 'a', on the left). */
  view(/** @type {'a'|'b'} */ side) {
    return side === this.me ? 'a' : 'b';
  }

  async play() {
    const r = this.result;
    this.trainerA.x -= 80;
    this.trainerB.x += 80;
    this.say(`${this.myName} vs ${this.theirName}!`);
    await Promise.all([
      this.tween({ targets: this.trainerA, x: POS.trainerA.x, duration: 450, ease: 'Quad.easeOut' }),
      this.tween({ targets: this.trainerB, x: POS.trainerB.x, duration: 450, ease: 'Quad.easeOut' }),
    ]);
    await this.wait(500);

    for (let i = 0; i < r.pairs.length; i++) {
      if (this.finished) return;
      await this.playPair(i);
    }
    if (this.finished) return;
    this.say(r.winner === 'draw' ? "It's a draw!"
      : r.winner === this.me ? 'You win the match!' : `${this.theirName} wins the match.`);
    await this.wait(1100);
    this.finish();
  }

  /** @param {number} i */
  async playPair(i) {
    const pair = this.result.pairs[i];
    const mine = pair[this.me];
    const theirs = pair[this.them];
    this.current = { a: mine, b: theirs };
    this.pairText.setText(`Pair ${i + 1} of ${this.result.pairs.length}`);

    // Both Mons come in at full HP.
    this.monA.setTexture(`mon-${mine.species}`).setPosition(POS.a.x - 70, POS.a.y).setAlpha(1);
    this.monB.setTexture(`mon-${theirs.species}`).setPosition(POS.b.x + 70, POS.b.y).setAlpha(1);
    this.boxA.set(speciesName(mine.species), mine.maxHp, mine.maxHp);
    this.boxB.set(speciesName(theirs.species), theirs.maxHp, theirs.maxHp);
    this.say(`Pair ${i + 1}: your ${speciesName(mine.species)} vs ${this.theirName}'s ${speciesName(theirs.species)}!`);
    await Promise.all([
      this.tween({ targets: this.monA, x: POS.a.x, duration: 300, ease: 'Quad.easeOut' }),
      this.tween({ targets: this.monB, x: POS.b.x, duration: 300, ease: 'Quad.easeOut' }),
    ]);
    await this.wait(250);

    for (const turn of pair.turns) {
      for (const e of turn) {
        if (this.finished) return;
        if (e.type === 'attack') await this.playAttack({ ...e, by: this.view(e.by) });
        else await this.playFaint(this.view(e.side));
      }
    }

    // Score the pair.
    const iWon = pair.winner === this.me;
    if (iWon) this.score.me++;
    else this.score.them++;
    this.updateScore();
    this.tweens.add({ targets: this.scoreText, scale: 1.3, duration: 150, yoyo: true });
    const winnerSprite = iWon ? this.monA : this.monB;
    this.sparkle(winnerSprite.x, winnerSprite.y - 24);
    this.say(iWon ? `You win pair ${i + 1}!` : `${this.theirName} wins pair ${i + 1}.`);
    await this.wait(500);

    // Both Mons leave the arena before the next pair.
    await Promise.all([
      this.tween({ targets: this.monA, x: POS.a.x - 90, alpha: 0, duration: 300, ease: 'Quad.easeIn' }),
      this.tween({ targets: this.monB, x: POS.b.x + 90, alpha: 0, duration: 300, ease: 'Quad.easeIn' }),
    ]);
  }

  /** Show the result screen (end of replay, or Skip). */
  finish() {
    if (this.finished) return;
    this.finished = true;
    /** @type {HTMLButtonElement} */ ($('replay-skip')).disabled = true;
    /** @type {HTMLButtonElement} */ ($('replay-speed')).disabled = true;
    showResult(this.result, () => {
      this.world.endMatch();
      this.scene.stop();
    });
  }
}
