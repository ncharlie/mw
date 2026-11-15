import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pvp } from '../server/pvp.js';
import { SPECIES } from '../shared/mons.js';
import { CHALLENGE_SECONDS, ORDER_SECONDS, PVP_TEAM_SIZE, PVP_MAX_TURNS } from '../shared/rules.js';

let nextId = 0;
/** A Mon with species base stats, plus overrides. */
function mon(species, overrides = {}) {
  const s = SPECIES[species];
  return { id: `m${nextId++}`, species, maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, ...overrides };
}
const strong = (species) => mon(species, { atk: 999, spd: 99 });
const weak = (species) => mon(species, { atk: 1, spd: 1 });
/** A party of ordinary Mons. */
const party = (...species) => species.map((s) => mon(s));
const ids = (pl) => pl.p.party.map((m) => m.id);

/** A fake online player that records what the server sends it. */
function player(name, mons) {
  const sent = [];
  return {
    name,
    sent,
    socket: { emit: (event, data) => sent.push([event, structuredClone(data)]) },
    p: { x: 0, y: 0, dir: 'down', wins: 0, coins: 0, shackles: 0, party: mons, storage: [] },
    battle: null,
    challenge: null,
    match: null,
    /** @param {string} event */
    got(event) {
      return sent.filter(([e]) => e === event).map(([, d]) => d);
    },
  };
}

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wins = [];
  const pvp = new Pvp({ save: () => {}, onWins: (pl) => wins.push(pl.name), random: () => 0.5 });
  return { pvp, wins, tick: (ms) => t.mock.timers.tick(ms) };
}

/** Challenge, accept, and return both players in the ordering phase. */
function startMatch(t, partyA, partyB) {
  const ctx = setup(t);
  const a = player('alice', partyA);
  const b = player('bob', partyB);
  ctx.pvp.challenge(a, b);
  ctx.pvp.answer(b, true);
  return { ...ctx, a, b };
}

/** Both players lock in their party in party order. */
function lockBoth(pvp, a, b) {
  pvp.setOrder(a, ids(a).slice(0, PVP_TEAM_SIZE), true);
  pvp.setOrder(b, ids(b).slice(0, PVP_TEAM_SIZE), true);
  return a.got('pvpResult')[0];
}

test('matches are always 3 Mons a side', () => {
  assert.equal(PVP_TEAM_SIZE, 3);
});

// ---------------------------------------------------------------- challenges

test('a challenge reaches the other player; declining tells the challenger', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const b = player('bob', party('fish', 'snake', 'cat'));
  pvp.challenge(a, b);
  assert.deepEqual(a.got('challengeSent'), [{ to: 'bob', seconds: CHALLENGE_SECONDS }]);
  assert.deepEqual(b.got('challenge'), [{ from: 'alice', seconds: CHALLENGE_SECONDS }]);
  assert.equal(Pvp.isFree(a), false, 'both are busy while it is pending');
  pvp.answer(b, false);
  assert.deepEqual(a.got('challengeClosed'), [{ text: 'bob declined your challenge.' }]);
  assert.ok(Pvp.isFree(a) && Pvp.isFree(b));
});

test('you need 3 Mons in your party to challenge', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird'));
  const b = player('bob', party('fish', 'snake', 'cat'));
  pvp.challenge(a, b);
  assert.equal(b.got('challenge').length, 0);
  assert.match(a.got('message')[0].text, /at least 3 Mons/);
  assert.equal(a.challenge, null);
});

test('players with fewer than 3 Mons cannot be challenged', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const b = player('bob', party('fish', 'snake'));
  pvp.challenge(a, b);
  assert.equal(b.got('challenge').length, 0);
  assert.deepEqual(a.got('message'), [{ text: "bob doesn't have 3 Mons in their party yet." }]);
});

test('only the challenged player can accept', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const b = player('bob', party('fish', 'snake', 'cat'));
  pvp.challenge(a, b);
  pvp.answer(a, true);
  assert.equal(a.match, null);
  assert.ok(b.challenge);
});

test('busy players cannot be challenged', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const inWild = player('bob', party('fish', 'snake', 'cat'));
  inWild.battle = {};
  pvp.challenge(a, inWild);
  assert.equal(inWild.got('challenge').length, 0);
  assert.deepEqual(a.got('message'), [{ text: 'bob is busy right now.' }]);
});

test('an unanswered challenge runs out', (t) => {
  const { pvp, tick } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const b = player('bob', party('fish', 'snake', 'cat'));
  pvp.challenge(a, b);
  tick(CHALLENGE_SECONDS * 1000);
  assert.deepEqual(a.got('challengeClosed'), [{ text: "bob didn't answer." }]);
  assert.equal(b.challenge, null);
});

test('the challenger can withdraw', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const b = player('bob', party('fish', 'snake', 'cat'));
  pvp.challenge(a, b);
  pvp.withdraw(a);
  assert.equal(b.got('challengeClosed')[0].text, 'alice took back the challenge.');
  assert.ok(Pvp.isFree(b));
});

// ---------------------------------------------------------------- ordering

test('the ordering screen always asks for 3 Mons and shows opponent species sorted', (t) => {
  const { a, b } = startMatch(t, party('fish', 'cat', 'bird', 'frog', 'snake'), party('snake', 'frog', 'cat'));
  const [orderA] = a.got('pvpOrder');
  const [orderB] = b.got('pvpOrder');
  assert.equal(orderA.pairs, 3);
  assert.equal(orderB.pairs, 3, 'even when one party has 5');
  assert.equal(orderA.opponent, 'bob');
  assert.equal(orderA.seconds, ORDER_SECONDS);
  assert.deepEqual(orderA.opponentSpecies, ['cat', 'snake', 'frog']);
  assert.deepEqual(orderB.opponentSpecies, ['cat', 'bird', 'snake', 'frog', 'fish'], 'sorted, not in party order');
  assert.deepEqual(orderA.order, ids(a).slice(0, 3), 'starts with the first 3 party Mons');
});

test('lineups are checked', (t) => {
  const { pvp, a, b } = startMatch(t, party('cat', 'bird', 'frog', 'fish'), party('fish', 'frog', 'snake'));
  const [w, x, y, z] = ids(a);
  assert.match(pvp.setOrder(a, [x, x, y], true), /different/);
  assert.match(pvp.setOrder(a, [x, y, ids(b)[0]], true), /different/, "can't use the opponent's Mon");
  assert.match(pvp.setOrder(a, [x, y], true), /exactly 3/);
  assert.match(pvp.setOrder(a, [w, x, y, z], false), /up to 3/);
  assert.match(pvp.setOrder(a, 'nope', false), /Pick/);
  assert.equal(pvp.setOrder(a, [z], false), null, 'partial lineups are fine before locking');
  assert.equal(pvp.setOrder(a, [z, y, w], true), null, 'any 3 of the party, in any order');
  assert.match(pvp.setOrder(a, [w, x, y], true), /already locked/);
  assert.deepEqual(b.got('pvpLocked'), [{ who: 'opponent' }]);
});

test('both players get the same result, fought in the order they arranged', (t) => {
  const { pvp, a, b } = startMatch(t,
    [weak('cat'), mon('frog'), strong('bird'), weak('fish')],
    [weak('fish'), weak('frog'), weak('snake')]);
  const [weakCat, frog, strongBird] = ids(a);
  pvp.setOrder(a, [strongBird, frog, weakCat], true);
  pvp.setOrder(b, ids(b), true);
  const [ra] = a.got('pvpResult');
  const [rb] = b.got('pvpResult');
  assert.equal(ra.you, 'a');
  assert.equal(rb.you, 'b');
  assert.deepEqual({ ...ra, you: '', wins: 0 }, { ...rb, you: '', wins: 0 }, 'same event log for both');
  assert.deepEqual(ra.pairs.map((p) => p.a.id), [strongBird, frog, weakCat], 'slot 1 fights slot 1, and so on');
  assert.equal(ra.pairs.length, 3);
  assert.deepEqual(ra.names, { a: 'alice', b: 'bob' });
  assert.equal(ra.pairs[0].winner, 'a');
});

test('replay turns are capped, and add up to the full fight', (t) => {
  // Two tanky Fish with weak attacks: a very long fight.
  const slowFish = () => mon('fish', { atk: 7, def: 12 });
  const { pvp, a, b } = startMatch(t, [slowFish(), slowFish(), slowFish()], [slowFish(), slowFish(), slowFish()]);
  pvp.setOrder(a, ids(a), true);
  pvp.setOrder(b, ids(b), true);
  const [r] = a.got('pvpResult');
  for (const pair of r.pairs) {
    assert.ok(pair.rounds.length > PVP_MAX_TURNS, 'this fight is long');
    assert.ok(pair.turns.length <= PVP_MAX_TURNS, `${pair.turns.length} turns`);
    const total = (events, side) => events.flat().filter((e) => e.type === 'attack' && e.by === side)
      .reduce((sum, e) => sum + e.damage, 0);
    assert.equal(total(pair.turns, 'a'), total(pair.rounds, 'a'));
    assert.equal(total(pair.turns, 'b'), total(pair.rounds, 'b'));
    assert.deepEqual(pair.turns.at(-1)?.at(-1), pair.rounds.at(-1)?.at(-1), 'same faint at the end');
  }
});

test('the winner gains a win', (t) => {
  const win = startMatch(t, [strong('cat'), strong('cat'), strong('cat')], [weak('fish'), weak('fish'), weak('fish')]);
  const r = lockBoth(win.pvp, win.a, win.b);
  assert.equal(r.winner, 'a');
  assert.deepEqual(r.score, { a: 3, b: 0 });
  assert.equal(win.a.p.wins, 1);
  assert.equal(win.b.p.wins, 0);
  assert.equal(r.wins, 1);
  assert.deepEqual(win.wins, ['alice']);
});

test('3 pairs means no draws: 2-1 wins the match', (t) => {
  const m = startMatch(t, [strong('frog'), weak('frog'), weak('frog')], [weak('snake'), strong('snake'), weak('snake')]);
  const r = lockBoth(m.pvp, m.a, m.b);
  assert.equal(r.pairs[0].winner, 'a');
  assert.equal(r.pairs[1].winner, 'b');
  assert.equal(r.score.a + r.score.b, 3);
  assert.notEqual(r.winner, 'draw');
});

test('when the timer runs out, the lineup locks as it is (topped up from the party)', (t) => {
  const { pvp, a, b, tick } = startMatch(t, party('cat', 'bird', 'frog', 'fish'), party('fish', 'snake', 'cat'));
  const [w, x, y, z] = ids(a);
  pvp.setOrder(a, [z], false); // only chose slot 1
  tick(ORDER_SECONDS * 1000 - 1);
  assert.equal(a.got('pvpResult').length, 0);
  tick(1000);
  const [r] = a.got('pvpResult');
  assert.deepEqual(r.pairs.map((p) => p.a.id), [z, w, x]);
  assert.ok(!r.pairs.some((p) => p.a.id === y));
  assert.equal(b.got('pvpResult').length, 1);
});

test('Mons fight at full HP even if hurt in the wild, and real HP is untouched', (t) => {
  const hurt = mon('cat', { hp: 1 });
  const { pvp, a, b } = startMatch(t, [hurt, mon('bird'), mon('frog')], party('fish', 'snake', 'cat'));
  const r = lockBoth(pvp, a, b);
  assert.equal(r.pairs[0].a.hp, r.pairs[0].a.maxHp);
  assert.equal(hurt.hp, 1);
});

test('players stay busy while watching the replay, until they are done', (t) => {
  const { pvp, a, b } = startMatch(t, party('cat', 'bird', 'frog'), party('fish', 'snake', 'cat'));
  lockBoth(pvp, a, b);
  assert.equal(Pvp.isFree(a), false);
  pvp.done(a);
  assert.ok(Pvp.isFree(a));
  assert.equal(Pvp.isFree(b), false);
  pvp.done(b);
  assert.ok(Pvp.isFree(b));
});

test('leaving during ordering cancels the match for the other player, with no wins', (t) => {
  const { pvp, a, b, tick } = startMatch(t, party('cat', 'bird', 'frog'), party('fish', 'snake', 'cat'));
  pvp.leave(a);
  assert.deepEqual(b.got('pvpCancelled'), [{ text: 'alice left. The match is off.' }]);
  assert.ok(Pvp.isFree(b));
  tick(ORDER_SECONDS * 1000 + 1000);
  assert.equal(b.got('pvpResult').length, 0);
});

test('leaving with a pending challenge closes it', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'bird', 'frog'));
  const b = player('bob', party('fish', 'snake', 'cat'));
  pvp.challenge(a, b);
  pvp.leave(b);
  assert.deepEqual(a.got('message'), [{ text: 'bob left.' }]);
  assert.ok(Pvp.isFree(a));
});

// ---------------------------------------------------------------- bot

test('the bot always fields 3 fresh random Mons', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'fish', 'frog', 'bird', 'snake'));
  pvp.challengeBot(a);
  const [order] = a.got('pvpOrder');
  assert.equal(order.opponent, 'Bot');
  assert.equal(order.bot, true);
  assert.equal(order.pairs, 3);
  assert.equal(order.opponentSpecies.length, 3);
});

test('the bot also needs you to have 3 Mons', (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'fish'));
  pvp.challengeBot(a);
  assert.equal(a.got('pvpOrder').length, 0);
  assert.match(a.got('message')[0].text, /at least 3 Mons/);
});

test('beating the bot counts as a win; the match needs only the player to lock', (t) => {
  const { pvp, wins } = setup(t);
  const a = player('alice', [strong('cat'), strong('cat'), strong('cat')]);
  pvp.challengeBot(a);
  pvp.setOrder(a, ids(a), true);
  const [r] = a.got('pvpResult');
  assert.equal(r.winner, 'a');
  assert.deepEqual(r.names, { a: 'alice', b: 'Bot' });
  assert.equal(r.bot, true);
  assert.equal(a.p.wins, 1);
  assert.deepEqual(wins, ['alice']);
});

test("can't start a bot match while busy", (t) => {
  const { pvp } = setup(t);
  const a = player('alice', party('cat', 'fish', 'frog'));
  a.battle = {};
  pvp.challengeBot(a);
  assert.equal(a.got('pvpOrder').length, 0);
});
