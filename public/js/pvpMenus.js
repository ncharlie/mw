// HTML screens around a PvP or bot match: the challenge prompt, the ordering
// screen (pick and order your Mons in 30 seconds) and the result screen.
// The fight itself is replayed by ReplayScene in between.

import { SPECIES } from '/shared/mons.js';
import { monImage } from './monArt.js';
import { $, el, openModal, closeModal } from './ui.js';
import { setModalActions } from './controls.js';

/** @typedef {import('/shared/mons.js').Mon} Mon */

/** @type {any} */
let socket = null;

/** @param {any} s */
export function setPvpSocket(s) {
  socket = s;
}

/** @param {string} id */
const speciesName = (id) => SPECIES[/** @type {import('/shared/mons.js').SpeciesId} */ (id)].name;

/**
 * Call `tick(secondsLeft)` now and every quarter second until it returns false.
 * @param {number} seconds
 * @param {(left: number) => boolean | void} tick
 */
function countdown(seconds, tick) {
  const deadline = Date.now() + seconds * 1000;
  const update = () => tick(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  update();
  return setInterval(update, 250);
}

// ---------------------------------------------------------------- challenge

/** @type {ReturnType<typeof setInterval> | undefined} */
let challengeTimer;
const acceptBtn = /** @type {HTMLButtonElement} */ ($('challenge-accept'));
const declineBtn = /** @type {HTMLButtonElement} */ ($('challenge-decline'));
const withdrawBtn = /** @type {HTMLButtonElement} */ ($('challenge-withdraw'));

/**
 * @param {'incoming'|'outgoing'} mode
 * @param {string} other the other player's name
 * @param {number} seconds
 */
export function showChallenge(mode, other, seconds) {
  const incoming = mode === 'incoming';
  $('challenge-title').textContent = incoming ? `${other} challenges you!` : `You challenged ${other}`;
  acceptBtn.hidden = !incoming;
  declineBtn.hidden = !incoming;
  withdrawBtn.hidden = incoming;
  for (const b of [acceptBtn, declineBtn, withdrawBtn]) b.disabled = false;
  clearInterval(challengeTimer);
  challengeTimer = countdown(seconds, (left) => {
    $('challenge-text').textContent = incoming
      ? `A match pairs your Mons slot by slot, all at full HP. Answer within ${left}s.`
      : `Waiting for ${other} to answer... ${left}s`;
  });
  openModal('challenge');
}

export function hideChallenge() {
  clearInterval(challengeTimer);
  closeModal('challenge');
}

acceptBtn.addEventListener('click', () => {
  acceptBtn.disabled = true;
  declineBtn.disabled = true;
  socket.emit('challengeAnswer', { accept: true });
});
declineBtn.addEventListener('click', () => {
  socket.emit('challengeAnswer', { accept: false });
  hideChallenge();
});
withdrawBtn.addEventListener('click', () => {
  withdrawBtn.disabled = true;
  socket.emit('challengeWithdraw');
});
// A accepts; B declines (or takes back your own challenge).
setModalActions('challenge', {
  a: () => { if (!acceptBtn.hidden) acceptBtn.click(); },
  b: () => (declineBtn.hidden ? withdrawBtn : declineBtn).click(),
});

// ---------------------------------------------------------------- ordering

const order = {
  /** @type {Mon[]} */ party: [],
  /** @type {string[]} */ opponentSpecies: [],
  pairs: 1,
  /** @type {(string | null)[]} one Mon id per slot */ slots: [],
  locked: false,
  timeUp: false,
  opponentLocked: false,
  opponent: '',
};
/** @type {ReturnType<typeof setInterval> | undefined} */
let orderTimer;
const lockBtn = /** @type {HTMLButtonElement} */ ($('order-lock'));

/**
 * The server's 'pvpOrder' message.
 * @param {{ opponent: string, bot: boolean, opponentSpecies: string[], party: Mon[], pairs: number,
 *   order: string[], seconds: number }} data
 */
export function showOrder(data) {
  Object.assign(order, {
    party: data.party,
    opponentSpecies: data.opponentSpecies,
    pairs: data.pairs,
    slots: Array.from({ length: data.pairs }, (_, i) => data.order[i] ?? null),
    locked: false,
    timeUp: false,
    opponentLocked: false,
    opponent: data.opponent,
  });
  $('order-title').textContent = data.bot ? 'Match vs Bot' : `Match vs ${data.opponent}`;
  $('order-note').textContent =
    `Pick ${data.pairs} Mon${data.pairs === 1 ? '' : 's'} and put them in fight order. ` +
    'Your slot 1 fights their slot 1, then slot 2 fights slot 2, and so on. Every Mon fights at full HP.';
  $('order-opponent').replaceChildren(...data.opponentSpecies.map((s) =>
    el('span', { className: 'species-chip' }, monImage(/** @type {any} */ (s), 28, true), speciesName(s))));

  clearInterval(orderTimer);
  orderTimer = countdown(data.seconds, (left) => {
    const timer = $('order-timer');
    timer.textContent = `${left}s`;
    timer.classList.toggle('urgent', left <= 5);
    if (left === 0 && !order.timeUp) {
      order.timeUp = true;
      renderOrder();
    }
  });
  openModal('order');
  renderOrder();
}

export function opponentLockedIn() {
  order.opponentLocked = true;
  renderOrder();
}

export function hideOrder() {
  clearInterval(orderTimer);
  closeModal('order');
}

const editable = () => !order.locked && !order.timeUp;

/** Tell the server the current lineup (it uses the latest one when time runs out). */
function sendOrder(lock = false) {
  const ids = /** @type {string[]} */ (order.slots.filter(Boolean));
  socket.emit('pvpOrder', { order: ids, lock }, (/** @type {any} */ res) => {
    if (lock && res.ok) order.locked = true;
    if (!res.ok) $('order-status').textContent = res.error;
    else renderOrder();
  });
}

/** @param {string} id */
function toggleMon(id) {
  if (!editable()) return;
  const at = order.slots.indexOf(id);
  if (at >= 0) {
    order.slots[at] = null;
  } else {
    const free = order.slots.indexOf(null);
    if (free < 0) return; // lineup full: clear a slot first
    order.slots[free] = id;
  }
  renderOrder();
  sendOrder();
}

function renderOrder() {
  const byId = new Map(order.party.map((m) => [m.id, m]));
  const theirs = new Set(order.opponentSpecies);

  $('order-slots').replaceChildren(...order.slots.map((id, i) => {
    const mon = id ? byId.get(id) : undefined;
    const slot = el('div', { className: `order-slot${mon ? ' filled' : ''}${editable() ? '' : ' locked'}` },
      el('span', { className: 'num' }, `Slot ${i + 1}`));
    if (mon) {
      slot.append(monImage(mon.species, 48), el('b', {}, speciesName(mon.species)), `HP ${mon.maxHp}`);
      slot.addEventListener('click', () => toggleMon(mon.id));
    } else {
      slot.append(el('div', {}, 'empty'));
    }
    return slot;
  }));

  $('order-party').replaceChildren(...order.party.map((mon) => {
    const at = order.slots.indexOf(mon.id);
    const strongVs = SPECIES[mon.species].strongAgainst;
    const row = el('div', { className: `mon-row${at >= 0 ? ' picked' : ''}${editable() ? '' : ' locked'}` },
      monImage(mon.species, 40),
      el('div', { className: 'info' },
        el('b', {}, speciesName(mon.species)),
        ` HP ${mon.maxHp} · ATK ${mon.atk} · DEF ${mon.def} · SPD ${mon.spd}`,
        el('div', { className: 'stats' },
          `Strong vs ${speciesName(strongVs)}`,
          theirs.has(strongVs) ? el('b', {}, ' — they have one!') : '')),
      el('span', { className: 'tag' }, at >= 0 ? `Slot ${at + 1}` : ''));
    row.addEventListener('click', () => toggleMon(mon.id));
    return row;
  }));

  const full = order.slots.every(Boolean);
  lockBtn.disabled = !editable() || !full;
  lockBtn.textContent = order.locked ? 'Locked in' : 'Lock in';
  let status = '';
  if (order.locked || order.timeUp) {
    status = order.opponentLocked || order.timeUp ? 'Starting the match...' : `Locked in. Waiting for ${order.opponent}...`;
  } else if (order.opponentLocked) {
    status = `${order.opponent} is ready.`;
  } else if (!full) {
    status = `Fill all ${order.pairs} slots.`;
  }
  $('order-status').textContent = status;
}

lockBtn.addEventListener('click', () => {
  if (!lockBtn.disabled) sendOrder(true);
});
// A locks in; there's no backing out of a match, so B does nothing here.
setModalActions('order', { a: () => lockBtn.click(), b: () => {} });

// ---------------------------------------------------------------- result

/** @type {(() => void) | null} */
let onResultClose = null;

/**
 * @param {{ you: 'a'|'b', names: {a: string, b: string}, score: {a: number, b: number},
 *   winner: 'a'|'b'|'draw', pairs: { a: Mon, b: Mon, winner: 'a'|'b' }[], wins: number }} r
 * @param {() => void} onClose
 */
export function showResult(r, onClose) {
  const me = r.you;
  const them = me === 'a' ? 'b' : 'a';
  const title = $('result-title');
  title.textContent = r.winner === 'draw' ? "It's a draw!" : r.winner === me ? 'You win!' : 'You lose...';
  title.className = r.winner === 'draw' ? '' : r.winner === me ? 'won' : 'lost';
  $('result-score').textContent = `${r.names[me]} ${r.score[me]} – ${r.score[them]} ${r.names[them]}`;
  $('result-pairs').replaceChildren(...r.pairs.map((pair) => el('li', { className: pair.winner === me ? 'won' : 'lost' },
    monImage(pair[me].species, 28), ` ${speciesName(pair[me].species)} vs `,
    monImage(pair[them].species, 28, true), ` ${speciesName(pair[them].species)} — `,
    pair.winner === me ? 'you won' : `${r.names[them]} won`)));
  $('result-wins').textContent = r.winner === me
    ? `+1 win! You now have ${r.wins}.`
    : `${r.winner === 'draw' ? 'Nobody gains a win.' : 'No win this time.'} You have ${r.wins}.`;
  onResultClose = onClose;
  openModal('result');
}

// A or B: back to the world.
setModalActions('result', {
  a: () => /** @type {HTMLButtonElement} */ ($('result-close')).click(),
  b: () => /** @type {HTMLButtonElement} */ ($('result-close')).click(),
});

$('result-close').addEventListener('click', () => {
  closeModal('result');
  onResultClose?.();
  onResultClose = null;
});
