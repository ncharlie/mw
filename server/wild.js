// A wild battle, run by the server for one player.
// Rounds happen on a timer; the player can throw shackles or run in between.
// Only this player hears about it: others just see them standing in the grass.

import { playRound } from '../shared/battle.js';
import { rollMon, randomSpecies, PARTY_SIZE } from '../shared/mons.js';
import { WILD_ROUND_MS, WILD_WIN_COINS, captureChance } from '../shared/rules.js';

/** Pause before the first round, while the client plays the intro. */
const INTRO_MS = 1500;
/** Extra pause after a failed throw, while the client plays the break-free animation. */
const THROW_PAUSE_MS = 1800;
/** Extra pause when a new party Mon has to come in. */
const SWITCH_PAUSE_MS = 700;

/**
 * @typedef {object} WildHooks
 * @property {() => string} newId a fresh unique Mon id
 * @property {() => void} sendSelf push the player's coins / shackles / party to their client
 * @property {() => void} sendToHospital heal the party and move the player to the hospital door
 * @property {() => void} save ask the store to save
 * @property {() => void} onEnd called once when the battle is over (for any reason)
 */

export class WildBattle {
  /**
   * @param {{ socket: { emit: (event: string, data?: any) => void }, p: import('./store.js').PlayerRecord }} player
   * @param {WildHooks} hooks
   * @param {() => number} [random] injectable for tests
   */
  constructor(player, hooks, random = Math.random) {
    this.socket = player.socket;
    this.p = player.p;
    this.hooks = hooks;
    this.random = random;
    this.wild = rollMon(randomSpecies(random), random, hooks.newId());
    /** Index in the party of the Mon fighting right now. */
    this.active = this.p.party.findIndex((m) => m.hp > 0);
    this.over = false;
    /** @type {NodeJS.Timeout | undefined} */
    this.timer = undefined;
  }

  /** Can this player fight at all? (at least one party Mon standing) */
  static canFight(/** @type {import('./store.js').PlayerRecord} */ p) {
    return p.party.some((m) => m.hp > 0);
  }

  start() {
    this.socket.emit('wildStart', {
      wild: this.wild,
      active: this.active,
      party: this.p.party,
      shackles: this.p.shackles,
    });
    this.schedule(INTRO_MS);
  }

  /** @param {number} ms */
  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.round(), ms);
  }

  round() {
    if (this.over) return;
    const mine = this.p.party[this.active];
    const result = playRound(mine, this.wild, this.random);
    mine.hp = result.hp.a;
    this.wild.hp = result.hp.b;
    this.hooks.save();

    if (result.fainted === 'b') {
      this.p.coins += WILD_WIN_COINS;
      this.socket.emit('wildRound', { events: result.events, hp: result.hp, active: this.active });
      this.finish('won', { coins: WILD_WIN_COINS });
      return;
    }
    if (result.fainted === 'a') {
      const next = this.p.party.findIndex((m) => m.hp > 0);
      this.socket.emit('wildRound', {
        events: result.events, hp: result.hp, active: next < 0 ? this.active : next,
      });
      if (next < 0) {
        this.hooks.sendToHospital();
        this.finish('lost');
        return;
      }
      this.active = next;
      this.schedule(WILD_ROUND_MS + SWITCH_PAUSE_MS);
      return;
    }
    this.socket.emit('wildRound', { events: result.events, hp: result.hp, active: this.active });
    this.schedule(WILD_ROUND_MS);
  }

  throwShackle() {
    if (this.over || this.p.shackles < 1) return;
    this.p.shackles--;
    const chance = captureChance(this.wild);
    const success = this.random() < chance;
    this.socket.emit('wildThrow', { success, chance, shackles: this.p.shackles });
    if (success) {
      const to = this.p.party.length < PARTY_SIZE ? 'party' : 'storage';
      this.p[to].push(this.wild); // keeps its current HP
      this.finish('caught', { to });
    } else {
      this.hooks.save();
      this.schedule(THROW_PAUSE_MS);
    }
  }

  run() {
    if (!this.over) this.finish('ran');
  }

  /** Stop quietly (player disconnected). */
  stop() {
    this.over = true;
    clearTimeout(this.timer);
    this.hooks.onEnd();
  }

  /**
   * @param {'won'|'caught'|'ran'|'lost'} result
   * @param {object} [extra]
   */
  finish(result, extra = {}) {
    this.over = true;
    clearTimeout(this.timer);
    this.socket.emit('wildEnd', { result, ...extra });
    this.hooks.sendSelf();
    this.hooks.save();
    this.hooks.onEnd();
  }
}
