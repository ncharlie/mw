// Battle rules, shared by wild battles and PvP / bot matches.
//
// Pure and deterministic: nothing here reads the clock or Math.random, and no
// input object is modified. Give the same Mons and the same seeded RNG and you
// get exactly the same battle, on the server or in the browser.
//
// Rules:
// - 1 vs 1, fully automatic. Each round both Mons attack once, higher SPD first
//   (a tie is broken by the RNG).
// - A Mon at 0 HP faints at once, so it does not get its attack that round.
// - Damage = max(1, round((ATK * advantage - DEF / 2) * random(0.9..1.1))).

import { advantageMultiplier } from './mons.js';
import { createRng } from './rng.js';

/** @typedef {import('./mons.js').Mon} Mon */
/** @typedef {'a'|'b'} Side */

/**
 * @typedef {{ type: 'attack', by: Side, damage: number, strong: boolean, hp: number, hits?: number }
 *   | { type: 'faint', side: Side }} BattleEvent
 * `attack.hp` is the target's HP after the hit; `strong` means the advantage bonus applied.
 * `hits` (in compressed turns only) is how many attacks were summed into this one.
 */

/** Safety net only: every hit does at least 1 damage, so fights always end sooner. */
const MAX_ROUNDS = 1000;

/** @param {Side} side @returns {Side} */
export const other = (side) => (side === 'a' ? 'b' : 'a');

/**
 * Damage of one hit.
 * @param {Mon} attacker
 * @param {Mon} defender
 * @param {() => number} rng
 */
export function calcDamage(attacker, defender, rng) {
  const advantage = advantageMultiplier(attacker.species, defender.species);
  const variance = 0.9 + rng() * 0.2;
  return Math.max(1, Math.round((attacker.atk * advantage - defender.def / 2) * variance));
}

/**
 * Who attacks first this round. Uses the RNG only on a SPD tie.
 * @param {Mon} a
 * @param {Mon} b
 * @param {() => number} rng
 * @returns {[Side, Side]}
 */
export function attackOrder(a, b, rng) {
  if (a.spd !== b.spd) return a.spd > b.spd ? ['a', 'b'] : ['b', 'a'];
  return rng() < 0.5 ? ['a', 'b'] : ['b', 'a'];
}

/**
 * Play one round. Returns both Mons' HP after the round, what happened, and
 * which side fainted (if any).
 * @param {Mon} a
 * @param {Mon} b
 * @param {() => number} rng
 * @returns {{ hp: Record<Side, number>, events: BattleEvent[], fainted: Side | null }}
 */
export function playRound(a, b, rng) {
  if (a.hp <= 0 || b.hp <= 0) throw new Error('A fainted Mon cannot fight');
  const mons = { a, b };
  const hp = { a: a.hp, b: b.hp };
  /** @type {BattleEvent[]} */
  const events = [];
  for (const side of attackOrder(a, b, rng)) {
    const target = other(side);
    const damage = calcDamage(mons[side], mons[target], rng);
    hp[target] = Math.max(0, hp[target] - damage);
    const strong = advantageMultiplier(mons[side].species, mons[target].species) > 1;
    events.push({ type: 'attack', by: side, damage, strong, hp: hp[target] });
    if (hp[target] === 0) {
      events.push({ type: 'faint', side: target });
      return { hp, events, fainted: target };
    }
  }
  return { hp, events, fainted: null };
}

/**
 * Fight until one Mon faints, starting from each Mon's current HP.
 * @param {Mon} a
 * @param {Mon} b
 * @param {() => number} rng
 * @returns {{ winner: Side, rounds: BattleEvent[][], hp: Record<Side, number> }}
 */
export function fight(a, b, rng) {
  let curA = a;
  let curB = b;
  /** @type {BattleEvent[][]} */
  const rounds = [];
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const round = playRound(curA, curB, rng);
    rounds.push(round.events);
    if (round.fainted) return { winner: other(round.fainted), rounds, hp: round.hp };
    curA = { ...curA, hp: round.hp.a };
    curB = { ...curB, hp: round.hp.b };
  }
  throw new Error('Fight did not end');
}

/**
 * @typedef {object} MatchResult
 * @property {number} seed
 * @property {{ a: Mon, b: Mon, rounds: BattleEvent[][], turns: BattleEvent[][], winner: Side }[]} pairs
 *   each pair's Mons as they entered (full HP), the full fight log (`rounds`), and the
 *   same fight grouped into at most `maxTurns` turns for the replay (`turns`)
 * @property {Record<Side, number>} score pairs won by each side
 * @property {Side | 'draw'} winner
 */

/**
 * A PvP or bot match: slot 1 fights slot 1, then slot 2 fights slot 2, and so
 * on. The number of pairs is the shorter team's length. Every Mon enters at
 * full HP (wild-battle damage is ignored) and no HP carries between pairs.
 * The side that wins more pairs wins; equal pair wins is a draw.
 * @param {Mon[]} teamA in the order player A chose
 * @param {Mon[]} teamB in the order player B chose
 * @param {number} seed
 * @param {number} [maxTurns] most turns per pair in `turns` (see compressRounds)
 * @returns {MatchResult}
 */
export function simulateMatch(teamA, teamB, seed, maxTurns = Infinity) {
  const rng = createRng(seed);
  const count = Math.min(teamA.length, teamB.length);
  /** @type {MatchResult['pairs']} */
  const pairs = [];
  const score = { a: 0, b: 0 };
  for (let i = 0; i < count; i++) {
    const a = { ...teamA[i], hp: teamA[i].maxHp };
    const b = { ...teamB[i], hp: teamB[i].maxHp };
    const result = fight(a, b, rng);
    score[result.winner]++;
    pairs.push({ a, b, rounds: result.rounds, turns: compressRounds(result.rounds, maxTurns), winner: result.winner });
  }
  return { seed, pairs, score, winner: matchWinner(score) };
}

/**
 * @param {Record<Side, number>} score pair wins per side
 * @returns {Side | 'draw'}
 */
export function matchWinner(score) {
  if (score.a > score.b) return 'a';
  if (score.b > score.a) return 'b';
  return 'draw';
}

/**
 * Group a fight's rounds into at most `maxTurns` turns, so a long fight (say
 * Fish vs Fish) can be shown quickly. Within a turn each Mon makes one attack
 * whose damage is the sum of its attacks in those rounds (`hits` says how
 * many). HP after each turn, total damage and the winner are all unchanged.
 * A short fight keeps one turn per round.
 * @param {BattleEvent[][]} rounds
 * @param {number} maxTurns
 * @returns {BattleEvent[][]}
 */
export function compressRounds(rounds, maxTurns) {
  const size = rounds.length <= maxTurns ? 1 : Math.ceil(rounds.length / maxTurns);
  /** @type {BattleEvent[][]} */
  const turns = [];
  for (let i = 0; i < rounds.length; i += size) turns.push(mergeRounds(rounds.slice(i, i + size)));
  return turns;
}

/** @param {BattleEvent[][]} chunk @returns {BattleEvent[]} */
function mergeRounds(chunk) {
  const events = chunk.flat();
  const attacks = /** @type {Extract<BattleEvent, {type: 'attack'}>[]} */ (events.filter((e) => e.type === 'attack'));
  const faint = events.find((e) => e.type === 'faint');
  // Who swings first: as in the first round, except that in the final turn the
  // Mon that faints goes first, so the knockout blow comes last.
  let order = [...new Set(attacks.map((e) => e.by))];
  if (faint && faint.type === 'faint') {
    order = [faint.side, other(faint.side)].filter((s) => order.includes(s));
  }
  /** @type {BattleEvent[]} */
  const merged = order.map((side) => {
    const mine = attacks.filter((e) => e.by === side);
    return {
      type: 'attack',
      by: side,
      damage: mine.reduce((sum, e) => sum + e.damage, 0),
      strong: mine.some((e) => e.strong),
      hp: mine[mine.length - 1].hp,
      hits: mine.length,
    };
  });
  if (faint) merged.push(faint);
  return merged;
}
