import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIES, SPECIES_IDS, STAT_SPREAD, advantageMultiplier, rollMon, isSpecies, randomSpecies,
} from '../shared/mons.js';
import { createRng } from '../shared/rng.js';

test('advantage forms one cycle: Cat > Bird > Snake > Frog > Fish > Cat', () => {
  const order = ['cat'];
  while (order.length < SPECIES_IDS.length) order.push(SPECIES[order[order.length - 1]].strongAgainst);
  assert.deepEqual(order, ['cat', 'bird', 'snake', 'frog', 'fish']);
  assert.equal(SPECIES.fish.strongAgainst, 'cat');
});

test('advantage multiplier is 1.5 one way only', () => {
  assert.equal(advantageMultiplier('cat', 'bird'), 1.5);
  assert.equal(advantageMultiplier('fish', 'cat'), 1.5);
  assert.equal(advantageMultiplier('bird', 'cat'), 1);
  assert.equal(advantageMultiplier('cat', 'cat'), 1);
  assert.equal(advantageMultiplier('cat', 'frog'), 1);
});

test('rolled stats stay within +/-10% of the species and start at full HP', () => {
  const rng = createRng(1);
  for (const id of SPECIES_IDS) {
    const base = SPECIES[id];
    for (let i = 0; i < 500; i++) {
      const mon = rollMon(id, rng);
      assert.equal(mon.species, id);
      assert.equal(mon.hp, mon.maxHp);
      for (const [stat, value] of [['hp', mon.maxHp], ['atk', mon.atk], ['def', mon.def], ['spd', mon.spd]]) {
        assert.ok(Number.isInteger(value), `${stat} is not an integer`);
        const lo = Math.round(base[stat] * (1 - STAT_SPREAD));
        const hi = Math.round(base[stat] * (1 + STAT_SPREAD));
        assert.ok(value >= lo && value <= hi, `${id} ${stat} ${value} outside ${lo}..${hi}`);
      }
    }
  }
});

test('rolls actually vary, and the same seed gives the same Mon', () => {
  const rng = createRng(2);
  const hps = new Set(Array.from({ length: 50 }, () => rollMon('fish', rng).maxHp));
  assert.ok(hps.size > 5);
  assert.deepEqual(rollMon('cat', createRng(9), 'x'), rollMon('cat', createRng(9), 'x'));
});

test('species helpers', () => {
  assert.ok(isSpecies('frog'));
  assert.ok(!isSpecies('dragon'));
  assert.ok(!isSpecies('toString'));
  const rng = createRng(3);
  const seen = new Set(Array.from({ length: 200 }, () => randomSpecies(rng)));
  assert.equal(seen.size, 5);
});
