// PvP and bot matches: challenge -> accept -> ordering (30 s) -> the server
// simulates the whole match at once -> both clients play the same event log.
//
// A player object here is the server's Online record: { name, socket, p, battle,
// challenge, match }. The bot is a side with no player behind it.

import crypto from 'node:crypto';
import { simulateMatch } from '../shared/battle.js';
import { rollMon, randomSpecies, SPECIES_IDS } from '../shared/mons.js';
import { BOT_NPC } from '../shared/world.js';
import { CHALLENGE_SECONDS, ORDER_SECONDS, PVP_TEAM_SIZE, PVP_MAX_TURNS } from '../shared/rules.js';

/** A little slack for messages still on their way when the order timer ends. */
const ORDER_GRACE_MS = 300;
/** If a client never says it finished watching, free the player after this. */
const REPLAY_TIMEOUT_MS = 5 * 60 * 1000;

/** @typedef {import('../shared/mons.js').Mon} Mon */
/** @typedef {'a'|'b'} SideId */

/**
 * @typedef {object} Player
 * @property {string} name
 * @property {{ emit: (event: string, data?: any) => void }} socket
 * @property {import('./store.js').PlayerRecord} p
 * @property {unknown} battle a wild battle, if any
 * @property {Challenge | null} challenge
 * @property {Match | null} match
 */

/**
 * @typedef {object} Challenge
 * @property {Player} from
 * @property {Player} to
 * @property {NodeJS.Timeout} timer
 */

/**
 * @typedef {object} Side
 * @property {string} name
 * @property {Player | null} player null for the bot
 * @property {Mon[]} party a snapshot taken when the match starts
 * @property {string[]} order Mon ids chosen so far, in fight order
 * @property {boolean} locked
 */

/** Species of a party, sorted, so the opponent learns what you have but not your order. */
const speciesOf = (/** @type {Mon[]} */ party) =>
  party.map((m) => m.species).sort((x, y) => SPECIES_IDS.indexOf(x) - SPECIES_IDS.indexOf(y));

export class Pvp {
  /**
   * @param {{ save: () => void, onWins: (player: Player) => void, random?: () => number }} hooks
   */
  constructor({ save, onWins, random = Math.random }) {
    this.save = save;
    this.onWins = onWins;
    this.random = random;
  }

  /** Free to start something new? (no battle, match, pending challenge; has Mons) @param {Player} pl */
  static isFree(pl) {
    return !pl.battle && !pl.match && !pl.challenge && pl.p.party.length > 0;
  }

  /** Enough Mons in the party for a match? @param {Player} pl */
  static hasTeam(pl) {
    return pl.p.party.length >= PVP_TEAM_SIZE;
  }

  /** Tell a player they need a bigger party. @param {Player} pl */
  static needTeam(pl) {
    pl.socket.emit('message', {
      text: `You need at least ${PVP_TEAM_SIZE} Mons in your party to battle. Catch some in the tall grass!`,
    });
  }

  // ------------------------------------------------------------ challenges

  /** @param {Player} from @param {Player} to */
  challenge(from, to) {
    if (!Pvp.isFree(from)) return;
    if (!Pvp.hasTeam(from)) {
      Pvp.needTeam(from);
      return;
    }
    if (!Pvp.hasTeam(to)) {
      from.socket.emit('message', { text: `${to.name} doesn't have ${PVP_TEAM_SIZE} Mons in their party yet.` });
      return;
    }
    if (!Pvp.isFree(to)) {
      from.socket.emit('message', { text: `${to.name} is busy right now.` });
      return;
    }
    /** @type {Challenge} */
    const c = {
      from,
      to,
      timer: setTimeout(
        () => this.closeChallenge(c, `${to.name} didn't answer.`, `The challenge from ${from.name} ran out.`),
        CHALLENGE_SECONDS * 1000,
      ),
    };
    from.challenge = c;
    to.challenge = c;
    from.socket.emit('challengeSent', { to: to.name, seconds: CHALLENGE_SECONDS });
    to.socket.emit('challenge', { from: from.name, seconds: CHALLENGE_SECONDS });
  }

  /** The challenged player answers. @param {Player} me @param {boolean} accept */
  answer(me, accept) {
    const c = me.challenge;
    if (!c || c.to !== me) return;
    if (!accept) {
      this.closeChallenge(c, `${me.name} declined your challenge.`, null);
      return;
    }
    clearTimeout(c.timer);
    c.from.challenge = null;
    c.to.challenge = null;
    new Match(this, c.from, c.to).start();
  }

  /** The challenger takes it back. @param {Player} me */
  withdraw(me) {
    const c = me.challenge;
    if (c && c.from === me) this.closeChallenge(c, null, `${me.name} took back the challenge.`);
  }

  /**
   * @param {Challenge} c
   * @param {string | null} toChallenger message for the challenger
   * @param {string | null} toChallenged message for the challenged player
   */
  closeChallenge(c, toChallenger, toChallenged) {
    clearTimeout(c.timer);
    if (c.from.challenge === c) c.from.challenge = null;
    if (c.to.challenge === c) c.to.challenge = null;
    c.from.socket.emit('challengeClosed', { text: toChallenger });
    c.to.socket.emit('challengeClosed', { text: toChallenged });
  }

  /** Talk to the bot: it always accepts. @param {Player} me */
  challengeBot(me) {
    if (!Pvp.isFree(me)) return;
    if (!Pvp.hasTeam(me)) {
      Pvp.needTeam(me);
      return;
    }
    // A fresh team of random Mons in random order, as many as a match needs.
    const team = Array.from({ length: PVP_TEAM_SIZE }, (_, i) =>
      rollMon(randomSpecies(this.random), this.random, `bot-${i + 1}`));
    new Match(this, me, null, team).start();
  }

  // ------------------------------------------------------------ during a match

  /**
   * Update (and maybe lock) a player's lineup.
   * @param {Player} me
   * @param {unknown} order Mon ids in fight order
   * @param {boolean} lock
   * @returns {string | null} error
   */
  setOrder(me, order, lock) {
    return me.match ? me.match.setOrder(me, order, lock) : 'You are not in a match.';
  }

  /** The player closed the result screen. @param {Player} me */
  done(me) {
    me.match?.release(me);
  }

  /** Disconnected or replaced by a new login. @param {Player} me */
  leave(me) {
    if (me.challenge) {
      const c = me.challenge;
      const other = c.from === me ? c.to : c.from;
      this.closeChallenge(c, null, null);
      other.socket.emit('message', { text: `${me.name} left.` });
    }
    me.match?.leave(me);
  }
}

class Match {
  /**
   * @param {Pvp} pvp
   * @param {Player} a
   * @param {Player | null} b null for the bot
   * @param {Mon[]} [botTeam]
   */
  constructor(pvp, a, b, botTeam = []) {
    this.pvp = pvp;
    this.phase = /** @type {'ordering'|'replay'|'over'} */ ('ordering');
    /** @type {Record<SideId, Side>} */
    this.sides = {
      a: { name: a.name, player: a, party: structuredClone(a.p.party), order: [], locked: false },
      b: b
        ? { name: b.name, player: b, party: structuredClone(b.p.party), order: [], locked: false }
        : { name: BOT_NPC.name, player: null, party: botTeam, order: botTeam.map((m) => m.id), locked: true },
    };
    /** Always the same number of pairs; both parties have at least this many Mons. */
    this.pairs = PVP_TEAM_SIZE;
    /** @type {NodeJS.Timeout | undefined} */
    this.timer = undefined;
  }

  /** @returns {SideId[]} the sides with a real player */
  humanSides() {
    return /** @type {SideId[]} */ (['a', 'b']).filter((s) => this.sides[s].player);
  }

  /** @param {Player} pl @returns {SideId | null} */
  sideOf(pl) {
    if (this.sides.a.player === pl) return 'a';
    if (this.sides.b.player === pl) return 'b';
    return null;
  }

  start() {
    for (const s of this.humanSides()) {
      const me = this.sides[s];
      const them = this.sides[s === 'a' ? 'b' : 'a'];
      const pl = /** @type {Player} */ (me.player);
      pl.match = this;
      // Start with the first Mons of the party, so a player who does nothing still has a lineup.
      me.order = me.party.slice(0, this.pairs).map((m) => m.id);
      pl.socket.emit('pvpOrder', {
        opponent: them.name,
        bot: !them.player,
        opponentSpecies: speciesOf(them.party),
        party: me.party,
        pairs: this.pairs,
        order: me.order,
        seconds: ORDER_SECONDS,
      });
    }
    this.timer = setTimeout(() => this.resolve(), ORDER_SECONDS * 1000 + ORDER_GRACE_MS);
  }

  /** @param {Player} pl @param {unknown} order @param {boolean} lock @returns {string | null} */
  setOrder(pl, order, lock) {
    const s = this.sideOf(pl);
    if (!s || this.phase !== 'ordering') return 'The lineup is already locked.';
    const side = this.sides[s];
    if (side.locked) return 'You already locked in.';
    const ids = new Set(side.party.map((m) => m.id));
    if (!Array.isArray(order) || order.length > this.pairs || new Set(order).size !== order.length
      || order.some((id) => !ids.has(id))) {
      return `Pick up to ${this.pairs} different Mons from your party.`;
    }
    if (lock && order.length !== this.pairs) return `Pick exactly ${this.pairs} Mons.`;
    side.order = /** @type {string[]} */ (order);
    if (lock) {
      side.locked = true;
      for (const other of this.humanSides()) {
        if (other !== s) this.sides[other].player?.socket.emit('pvpLocked', { who: 'opponent' });
      }
      if (this.sides.a.locked && this.sides.b.locked) this.resolve();
    }
    return null;
  }

  /** The lineup that fights: the chosen Mons, topped up from the party if short. @param {SideId} s */
  finalTeam(s) {
    const side = this.sides[s];
    const byId = new Map(side.party.map((m) => [m.id, m]));
    const team = side.order.map((id) => /** @type {Mon} */ (byId.get(id)));
    for (const m of side.party) {
      if (team.length >= this.pairs) break;
      if (!team.includes(m)) team.push(m);
    }
    return team;
  }

  /** Lock both lineups and play the whole match. */
  resolve() {
    if (this.phase !== 'ordering') return;
    clearTimeout(this.timer);
    this.phase = 'replay';
    const seed = crypto.randomInt(2 ** 31);
    const result = simulateMatch(this.finalTeam('a'), this.finalTeam('b'), seed, PVP_MAX_TURNS);

    if (result.winner !== 'draw') {
      const winner = this.sides[result.winner].player;
      if (winner) {
        winner.p.wins += 1;
        this.pvp.save();
        this.pvp.onWins(winner);
      }
    }
    for (const s of this.humanSides()) {
      const pl = /** @type {Player} */ (this.sides[s].player);
      pl.socket.emit('pvpResult', {
        ...result,
        you: s,
        names: { a: this.sides.a.name, b: this.sides.b.name },
        bot: !this.sides.a.player || !this.sides.b.player,
        wins: pl.p.wins,
      });
    }
    // Players stay busy while they watch the replay, until they say they're done.
    this.timer = setTimeout(() => {
      for (const s of this.humanSides()) this.release(/** @type {Player} */ (this.sides[s].player));
    }, REPLAY_TIMEOUT_MS);
  }

  /** This player is finished with the match. @param {Player} pl */
  release(pl) {
    if (pl.match === this) pl.match = null;
    if (this.humanSides().every((s) => this.sides[s].player?.match !== this)) {
      this.phase = 'over';
      clearTimeout(this.timer);
    }
  }

  /** @param {Player} pl */
  leave(pl) {
    if (this.phase === 'ordering') {
      clearTimeout(this.timer);
      this.phase = 'over';
      for (const s of this.humanSides()) {
        const other = /** @type {Player} */ (this.sides[s].player);
        other.match = null;
        if (other !== pl) other.socket.emit('pvpCancelled', { text: `${pl.name} left. The match is off.` });
      }
      return;
    }
    this.release(pl);
  }
}
