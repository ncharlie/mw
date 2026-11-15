import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WildBattle } from '../server/wild.js';
import { SPECIES } from '../shared/mons.js';
import { WILD_WIN_COINS, WILD_ROUND_MS, captureChance } from '../shared/rules.js';

/** A Mon with species base stats, plus overrides. */
function mon(species, overrides = {}) {
  const s = SPECIES[species];
  return { id: `${species}-${Math.random()}`, species, maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, ...overrides };
}

/**
 * A battle with a fake socket. random() always returns 0.5, so the wild Mon is
 * a Snake with exactly its base stats, and damage has no variance.
 */
function setup(t, party, { shackles = 3, storage = [] } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {[string, any][]} */
  const sent = [];
  const calls = { hospital: 0, self: 0, end: 0 };
  const p = { x: 0, y: 0, dir: 'down', wins: 0, coins: 0, shackles, party, storage };
  const player = { socket: { emit: (e, d) => sent.push([e, structuredClone(d)]) }, p };
  const battle = new WildBattle(player, {
    newId: () => 'wild-1',
    sendSelf: () => calls.self++,
    sendToHospital: () => calls.hospital++,
    save: () => {},
    onEnd: () => calls.end++,
  }, () => 0.5);
  battle.start();
  const events = (name) => sent.filter(([e]) => e === name).map(([, d]) => d);
  return { battle, p, sent, calls, events, tick: (ms) => t.mock.timers.tick(ms) };
}

test('battle starts, then rounds run on a timer and damage sticks', (t) => {
  const cat = mon('cat');
  const { battle, events, tick } = setup(t, [cat]);
  assert.equal(battle.wild.species, 'snake');
  assert.deepEqual(events('wildStart')[0].wild.id, 'wild-1');
  assert.equal(events('wildRound').length, 0, 'no round during the intro');
  tick(1500);
  assert.equal(events('wildRound').length, 1);
  tick(WILD_ROUND_MS);
  assert.equal(events('wildRound').length, 2);
  assert.ok(cat.hp < cat.maxHp, 'HP damage is kept on the party Mon');
  assert.ok(battle.wild.hp < battle.wild.maxHp);
});

test('capture chance is 100 minus remaining HP percent', () => {
  assert.equal(captureChance({ hp: 80, maxHp: 80 }), 0);
  assert.equal(captureChance({ hp: 20, maxHp: 80 }), 0.75);
  assert.equal(captureChance({ hp: 0, maxHp: 80 }), 1);
});

test('a throw at full HP always fails, uses a shackle, and the fight goes on', (t) => {
  const { battle, p, events, tick } = setup(t, [mon('cat')]);
  battle.throwShackle();
  assert.equal(p.shackles, 2);
  assert.deepEqual(events('wildThrow'), [{ success: false, chance: 0, shackles: 2 }]);
  assert.equal(battle.over, false);
  tick(5000);
  assert.ok(events('wildRound').length > 0);
});

test('a successful throw adds the Mon to the party, with its current HP', (t) => {
  const { battle, p, events, calls } = setup(t, [mon('cat')]);
  battle.wild.hp = 10; // 87.5% chance, and random() is 0.5
  battle.throwShackle();
  assert.equal(events('wildThrow')[0].success, true);
  assert.equal(p.party.length, 2);
  assert.equal(p.party[1].id, 'wild-1');
  assert.equal(p.party[1].hp, 10);
  assert.deepEqual(events('wildEnd'), [{ result: 'caught', to: 'party' }]);
  assert.equal(calls.end, 1);
  assert.equal(calls.self, 1);
});

test('with a full party, a caught Mon goes to storage', (t) => {
  const party = ['cat', 'bird', 'frog', 'fish', 'cat'].map((s) => mon(s));
  const { battle, p, events } = setup(t, party);
  battle.wild.hp = 1;
  battle.throwShackle();
  assert.equal(p.party.length, 5);
  assert.equal(p.storage.length, 1);
  assert.deepEqual(events('wildEnd'), [{ result: 'caught', to: 'storage' }]);
});

test('no shackles, no throw', (t) => {
  const { battle, p, events } = setup(t, [mon('cat')], { shackles: 0 });
  battle.wild.hp = 1;
  battle.throwShackle();
  assert.equal(p.shackles, 0);
  assert.equal(events('wildThrow').length, 0);
  assert.equal(battle.over, false);
});

test('knocking out the wild Mon pays coins and ends the battle', (t) => {
  const { p, events, tick, calls } = setup(t, [mon('cat', { atk: 999 })]);
  tick(1500);
  assert.equal(p.coins, WILD_WIN_COINS);
  assert.deepEqual(events('wildEnd'), [{ result: 'won', coins: WILD_WIN_COINS }]);
  assert.equal(calls.end, 1);
  tick(10_000);
  assert.equal(events('wildRound').length, 1, 'no rounds after the end');
});

test('when the active Mon faints, the next one that can fight comes in', (t) => {
  const weak = mon('cat', { hp: 1, atk: 1 });
  const fainted = mon('bird', { hp: 0 });
  const healthy = mon('frog');
  const { battle, events, tick } = setup(t, [weak, fainted, healthy]);
  tick(1500);
  const round = events('wildRound')[0];
  assert.equal(round.active, 2);
  assert.equal(battle.active, 2);
  assert.equal(battle.over, false);
});

test('if every party Mon faints, the player is sent to the hospital', (t) => {
  const { events, tick, calls } = setup(t, [mon('cat', { hp: 1, atk: 1 })]);
  tick(1500);
  assert.equal(calls.hospital, 1);
  assert.deepEqual(events('wildEnd'), [{ result: 'lost' }]);
});

test('running always works and stops the rounds', (t) => {
  const { battle, events, tick } = setup(t, [mon('cat')]);
  battle.run();
  assert.deepEqual(events('wildEnd'), [{ result: 'ran' }]);
  tick(10_000);
  assert.equal(events('wildRound').length, 0);
  battle.throwShackle();
  assert.equal(events('wildThrow').length, 0, 'no throws after the battle');
});

test('canFight needs one party Mon with HP left', () => {
  assert.equal(WildBattle.canFight({ party: [mon('cat', { hp: 0 })] }), false);
  assert.equal(WildBattle.canFight({ party: [mon('cat', { hp: 0 }), mon('fish')] }), true);
  assert.equal(WildBattle.canFight({ party: [] }), false);
});
