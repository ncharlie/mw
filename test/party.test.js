import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeParty, healParty } from '../server/party.js';

const m = (id, hp = 10) => ({ id, species: 'cat', maxHp: 10, hp, atk: 1, def: 1, spd: 1 });
const ids = (list) => list.map((x) => x.id);
const player = () => ({ party: [m('a'), m('b'), m('c')], storage: [m('x'), m('y')] });

test('reorder the party', () => {
  const p = player();
  assert.equal(arrangeParty(p, ['c', 'a', 'b']), null);
  assert.deepEqual(ids(p.party), ['c', 'a', 'b']);
  assert.deepEqual(ids(p.storage), ['x', 'y']);
});

test('swap a party Mon with a stored one', () => {
  const p = player();
  assert.equal(arrangeParty(p, ['a', 'y', 'c']), null);
  assert.deepEqual(ids(p.party), ['a', 'y', 'c']);
  assert.deepEqual(ids(p.storage), ['x', 'b']);
});

test('store and take out', () => {
  const p = player();
  assert.equal(arrangeParty(p, ['a']), null);
  assert.deepEqual(ids(p.storage), ['x', 'y', 'b', 'c']);
  assert.equal(arrangeParty(p, ['a', 'x', 'y', 'b', 'c']), null);
  assert.deepEqual(p.storage, []);
});

test('bad requests are refused and change nothing', () => {
  for (const bad of [[], ['a', 'b', 'c', 'x', 'y', 'z'], ['a', 'a'], ['a', 'nope'], 'a', null, [{}]]) {
    const p = player();
    assert.equal(typeof arrangeParty(p, bad), 'string', JSON.stringify(bad));
    assert.deepEqual(p, player());
  }
});

test('healing restores every party Mon but not storage', () => {
  const p = { party: [m('a', 0), m('b', 4)], storage: [m('x', 2)] };
  healParty(p);
  assert.deepEqual(p.party.map((x) => x.hp), [10, 10]);
  assert.equal(p.storage[0].hp, 2);
});
