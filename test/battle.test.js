import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcDamage, attackOrder, playRound, fight, simulateMatch, matchWinner, compressRounds,
} from '../shared/battle.js';
import { SPECIES, rollMon, SPECIES_IDS } from '../shared/mons.js';
import { createRng } from '../shared/rng.js';

/** An RNG that always returns the same value. */
const fixed = (v) => () => v;
/** RNG value that makes the damage variance exactly 1.0. */
const MID = 0.5;

/** A Mon with species base stats, plus overrides. */
function mon(species, overrides = {}) {
  const s = SPECIES[species];
  const m = { id: '', species, maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, ...overrides };
  if (overrides.maxHp && !('hp' in overrides)) m.hp = overrides.maxHp;
  return m;
}

const randomTeam = (rng, n) => Array.from({ length: n }, (_, i) => rollMon(SPECIES_IDS[i % 5], rng));

// ---------------------------------------------------------------- damage

test('damage formula without advantage', () => {
  // (20 - 10/2) * 1.0 = 15
  assert.equal(calcDamage(mon('bird', { atk: 20 }), mon('cat', { def: 10 }), fixed(MID)), 15);
});

test('advantage multiplies attack by 1.5', () => {
  // Cat is strong against Bird: (20 * 1.5 - 10/2) = 25
  assert.equal(calcDamage(mon('cat', { atk: 20 }), mon('bird', { def: 10 }), fixed(MID)), 25);
  // ...but not the other way round.
  assert.equal(calcDamage(mon('bird', { atk: 20 }), mon('cat', { def: 10 }), fixed(MID)), 15);
});

test('damage varies between 0.9x and 1.1x', () => {
  const a = mon('frog', { atk: 25 });
  const b = mon('frog', { def: 10 }); // base damage 20
  assert.equal(calcDamage(a, b, fixed(0)), 18);
  assert.equal(calcDamage(a, b, fixed(0.99999)), 22);
});

test('damage is always at least 1', () => {
  assert.equal(calcDamage(mon('fish', { atk: 1 }), mon('fish', { def: 100 }), fixed(0)), 1);
});

// ---------------------------------------------------------------- rounds

test('the faster Mon attacks first; a SPD tie is decided by the RNG', () => {
  assert.deepEqual(attackOrder(mon('bird'), mon('fish'), fixed(0.9)), ['a', 'b']);
  assert.deepEqual(attackOrder(mon('fish'), mon('bird'), fixed(0.1)), ['b', 'a']);
  assert.deepEqual(attackOrder(mon('cat'), mon('cat'), fixed(0.1)), ['a', 'b']);
  assert.deepEqual(attackOrder(mon('cat'), mon('cat'), fixed(0.9)), ['b', 'a']);
});

test('a normal round: both attack once, HP goes down', () => {
  const r = playRound(mon('cat'), mon('frog'), fixed(MID));
  assert.equal(r.fainted, null);
  assert.deepEqual(r.events.map((e) => e.type === 'attack' && e.by), ['a', 'b']);
  assert.ok(r.hp.a < SPECIES.cat.hp && r.hp.b < SPECIES.frog.hp);
});

test('a Mon at 0 HP faints immediately and does not attack back', () => {
  const fast = mon('bird', { atk: 999, spd: 50 });
  const slow = mon('fish', { spd: 1 });
  const r = playRound(slow, fast, fixed(MID));
  assert.equal(r.fainted, 'a');
  assert.equal(r.events.length, 2, 'only one attack happened');
  assert.ok(r.events[0].type === 'attack' && r.events[0].by === 'b' && r.events[0].hp === 0);
  assert.deepEqual(r.events[1], { type: 'faint', side: 'a' });
  assert.equal(r.hp.a, 0, 'HP never goes below 0');
});

test('the slower Mon still knocks out the faster one if it survives', () => {
  const r = playRound(mon('bird', { spd: 50 }), mon('fish', { atk: 999, spd: 1 }), fixed(MID));
  assert.deepEqual(r.events.map((e) => e.type), ['attack', 'attack', 'faint']);
  assert.equal(r.fainted, 'a');
});

test('a fainted Mon cannot start a round', () => {
  assert.throws(() => playRound(mon('cat', { hp: 0 }), mon('cat'), fixed(MID)));
});

test('advantage is flagged in the event log', () => {
  const r = playRound(mon('cat', { spd: 99 }), mon('bird', { spd: 1 }), fixed(MID));
  const [first, second] = r.events;
  assert.ok(first.type === 'attack' && first.strong);
  assert.ok(second.type === 'attack' && !second.strong);
});

// ---------------------------------------------------------------- whole fights

test('a fight runs until one Mon faints and does not change its inputs', () => {
  const a = mon('snake');
  const b = mon('frog', { hp: 30 }); // already hurt: fights start from current HP
  const before = structuredClone([a, b]);
  const result = fight(a, b, createRng(5));
  assert.deepEqual([a, b], before);
  const last = result.rounds.at(-1)?.at(-1);
  assert.deepEqual(last, { type: 'faint', side: result.winner === 'a' ? 'b' : 'a' });
  assert.equal(result.hp[result.winner === 'a' ? 'b' : 'a'], 0);
  assert.ok(result.hp[result.winner] > 0);
});

test('same seed, same fight; different seeds can differ', () => {
  const a = mon('cat');
  const b = mon('fish');
  assert.deepEqual(fight(a, b, createRng(11)), fight(a, b, createRng(11)));
  const logs = new Set(Array.from({ length: 10 }, (_, s) => JSON.stringify(fight(a, b, createRng(s)))));
  assert.ok(logs.size > 1);
});

// ---------------------------------------------------------------- PvP matches

test('same seed gives an identical match', () => {
  const rng = createRng(100);
  const teamA = randomTeam(rng, 4);
  const teamB = randomTeam(rng, 4);
  assert.deepEqual(simulateMatch(teamA, teamB, 42), simulateMatch(teamA, teamB, 42));
  const results = new Set(Array.from({ length: 10 }, (_, s) => JSON.stringify(simulateMatch(teamA, teamB, s))));
  assert.ok(results.size > 1);
});

test('number of pairs is the smaller team size, matched slot by slot', () => {
  const rng = createRng(7);
  const teamA = randomTeam(rng, 5);
  const teamB = randomTeam(rng, 3);
  const result = simulateMatch(teamA, teamB, 1);
  assert.equal(result.pairs.length, 3);
  result.pairs.forEach((pair, i) => {
    assert.equal(pair.a.species, teamA[i].species);
    assert.equal(pair.b.species, teamB[i].species);
  });
  assert.equal(result.score.a + result.score.b, 3);
});

test('every Mon enters at full HP, whatever damage it had', () => {
  const teamA = [mon('cat', { hp: 1 }), mon('bird', { hp: 3 })];
  const teamB = [mon('frog', { hp: 2 }), mon('fish', { hp: 5 })];
  for (const pair of simulateMatch(teamA, teamB, 3).pairs) {
    assert.equal(pair.a.hp, pair.a.maxHp);
    assert.equal(pair.b.hp, pair.b.maxHp);
  }
  assert.equal(teamA[0].hp, 1, 'the teams passed in are not modified');
});

test('more pair wins wins the match; equal pair wins is a draw', () => {
  const strong = (species) => mon(species, { atk: 999, spd: 99 });
  const weak = (species) => mon(species, { atk: 1, spd: 1 });

  const aWins = simulateMatch([strong('cat'), strong('cat'), weak('cat')], [weak('fish'), weak('fish'), strong('fish')], 1);
  assert.deepEqual(aWins.score, { a: 2, b: 1 });
  assert.equal(aWins.winner, 'a');
  assert.deepEqual(aWins.pairs.map((p) => p.winner), ['a', 'a', 'b']);

  const bWins = simulateMatch([weak('cat')], [strong('cat')], 1);
  assert.equal(bWins.winner, 'b');

  const draw = simulateMatch([strong('frog'), weak('frog')], [weak('snake'), strong('snake')], 1);
  assert.deepEqual(draw.score, { a: 1, b: 1 });
  assert.equal(draw.winner, 'draw');
});

test('matchWinner', () => {
  assert.equal(matchWinner({ a: 3, b: 2 }), 'a');
  assert.equal(matchWinner({ a: 0, b: 1 }), 'b');
  assert.equal(matchWinner({ a: 2, b: 2 }), 'draw');
  assert.equal(matchWinner({ a: 0, b: 0 }), 'draw');
});

// ---------------------------------------------------------------- compressed turns

/** Total damage dealt by one side in a list of rounds/turns. */
const dealt = (rounds, side) => rounds.flat().filter((e) => e.type === 'attack' && e.by === side)
  .reduce((sum, e) => sum + e.damage, 0);

test('a short fight keeps one turn per round', () => {
  const { rounds } = fight(mon('bird', { atk: 60 }), mon('snake'), createRng(1));
  assert.ok(rounds.length <= 4);
  const turns = compressRounds(rounds, 4);
  assert.equal(turns.length, rounds.length);
  turns.forEach((turn, i) => {
    assert.deepEqual(turn.map((e) => (e.type === 'attack' ? { ...e, hits: undefined } : e)),
      rounds[i].map((e) => (e.type === 'attack' ? { ...e, hits: undefined } : e)));
  });
});

test('a long fight is grouped into at most maxTurns turns with damage summed', () => {
  for (let seed = 0; seed < 30; seed++) {
    const { rounds, winner } = fight(mon('fish'), mon('fish'), createRng(seed));
    assert.ok(rounds.length > 4, 'Fish vs Fish is long');
    const turns = compressRounds(rounds, 4);
    assert.ok(turns.length <= 4);
    assert.equal(dealt(turns, 'a'), dealt(rounds, 'a'));
    assert.equal(dealt(turns, 'b'), dealt(rounds, 'b'));
    assert.equal(turns.flat().filter((e) => e.type === 'attack').reduce((n, e) => n + e.hits, 0),
      rounds.flat().filter((e) => e.type === 'attack').length, 'every attack is counted once');
    // Ends the same way: the loser faints last, after the winner's final blow.
    const last = turns.at(-1);
    const loser = winner === 'a' ? 'b' : 'a';
    assert.deepEqual(last.at(-1), { type: 'faint', side: loser });
    const finalBlow = last.at(-2);
    assert.ok(finalBlow.type === 'attack' && finalBlow.by === winner && finalBlow.hp === 0);
    // HP never goes up between turns.
    const hpSeen = { a: Infinity, b: Infinity };
    for (const e of turns.flat()) {
      if (e.type !== 'attack') continue;
      const target = e.by === 'a' ? 'b' : 'a';
      assert.ok(e.hp <= hpSeen[target]);
      hpSeen[target] = e.hp;
    }
  }
});

test('simulateMatch adds capped turns to every pair', () => {
  const team = () => [mon('fish'), mon('fish'), mon('frog')];
  const result = simulateMatch(team(), team(), 9, 4);
  for (const pair of result.pairs) {
    assert.ok(pair.turns.length <= 4);
    assert.equal(dealt(pair.turns, 'a'), dealt(pair.rounds, 'a'));
  }
});
