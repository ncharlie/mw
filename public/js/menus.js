// HTML menus: starter choice, shop, party.
// They send requests with Socket.IO acknowledgements; the server answers
// { ok, error? } and pushes the new 'self' state, which re-renders them.

import { SPECIES, SPECIES_IDS, PARTY_SIZE } from '/shared/mons.js';
import { MAX_BUY } from '/shared/rules.js';
import { monImage, shackleImage } from './monArt.js';
import { $, el, openModal, closeModal, isModalOpen, hpBar } from './ui.js';
import { setModalActions } from './controls.js';

/** @typedef {import('/shared/mons.js').Mon} Mon */
/** @typedef {{ coins: number, shackles: number, party: Mon[], storage: Mon[] }} Self */

/** @type {any} */
let socket = null;
/** @type {Self} */
let self = { coins: 0, shackles: 0, party: [], storage: [] };

/** Call when (re)connecting. @param {any} s */
export function setSocket(s) {
  socket = s;
}

/** New private state from the server. Re-renders whatever is open. @param {Self} next */
export function setSelf(next) {
  self = next;
  if (isModalOpen('shop')) renderShop();
  if (isModalOpen('party')) renderParty();
  if (isModalOpen('starter') && self.party.length > 0) closeModal('starter');
}

/** @param {string} id */
const speciesName = (id) => SPECIES[/** @type {import('/shared/mons.js').SpeciesId} */ (id)].name;

// ---------------------------------------------------------------- starter

/** @type {string | null} */
let starterPick = null;

export function showStarter() {
  starterPick = null;
  const list = $('starter-list');
  list.replaceChildren(...SPECIES_IDS.map((id) => {
    const s = SPECIES[id];
    const card = el('button', { type: 'button', className: 'starter-card' },
      monImage(id, 80),
      el('b', {}, s.name),
      el('small', {}, `HP ${s.hp} · ATK ${s.atk}`),
      el('small', {}, `DEF ${s.def} · SPD ${s.spd}`),
      el('small', {}, `Strong vs ${SPECIES[s.strongAgainst].name}`));
    card.addEventListener('click', () => {
      starterPick = id;
      for (const c of list.children) c.classList.toggle('selected', c === card);
      const confirm = /** @type {HTMLButtonElement} */ ($('starter-confirm'));
      confirm.disabled = false;
      confirm.textContent = `Choose ${s.name}`;
    });
    return card;
  }));
  const confirm = /** @type {HTMLButtonElement} */ ($('starter-confirm'));
  confirm.disabled = true;
  confirm.textContent = 'Pick one';
  $('starter-error').textContent = '';
  openModal('starter');
}

// A confirms the picked starter (picking is by tap / click).
setModalActions('starter', { a: () => /** @type {HTMLButtonElement} */ ($('starter-confirm')).click() });

$('starter-confirm').addEventListener('click', () => {
  if (!starterPick) return;
  socket.emit('chooseStarter', { species: starterPick }, (/** @type {any} */ res) => {
    if (!res.ok) $('starter-error').textContent = res.error;
  });
});

// ---------------------------------------------------------------- shop

let shopPrice = 10;
const qtyInput = /** @type {HTMLInputElement} */ ($('shop-qty'));
$('shop-icon').append(shackleImage(48));

/** @param {number} price */
export function openShop(price) {
  shopPrice = price;
  qtyInput.value = '1';
  $('shop-status').textContent = '';
  openModal('shop');
  renderShop();
}

function quantity() {
  const n = Math.round(Number(qtyInput.value));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_BUY, n)) : 1;
}

function renderShop() {
  const qty = quantity();
  const cost = qty * shopPrice;
  $('shop-price').textContent = String(shopPrice);
  $('shop-total').textContent = `= ${cost} coins`;
  $('shop-wallet').textContent = `You have ${self.coins} coins and ${self.shackles} shackles.`;
  /** @type {HTMLButtonElement} */ ($('shop-buy')).disabled = cost > self.coins;
}

$('shop-less').addEventListener('click', () => {
  qtyInput.value = String(Math.max(1, quantity() - 1));
  renderShop();
});
$('shop-more').addEventListener('click', () => {
  qtyInput.value = String(Math.min(MAX_BUY, quantity() + 1));
  renderShop();
});
qtyInput.addEventListener('input', renderShop);
$('shop-close').addEventListener('click', () => closeModal('shop'));
// A buys, B closes (the default for menus).
setModalActions('shop', { a: () => /** @type {HTMLButtonElement} */ ($('shop-buy')).click() });
$('shop-buy').addEventListener('click', () => {
  const qty = quantity();
  socket.emit('buy', { qty }, (/** @type {any} */ res) => {
    $('shop-status').textContent = res.ok
      ? `You bought ${qty} shackle${qty === 1 ? '' : 's'}. Thank you!`
      : res.error;
  });
});

// ---------------------------------------------------------------- party

/** The Mon clicked first when swapping. @type {{ list: 'party'|'storage', index: number } | null} */
let selected = null;

export function toggleParty() {
  if (isModalOpen('party')) {
    closeModal('party');
    return;
  }
  selected = null;
  $('party-error').textContent = '';
  openModal('party');
  renderParty();
}

$('party-close').addEventListener('click', () => closeModal('party'));

/** Ask the server for a new party (ids in order); everything else is stored. @param {string[]} ids */
function sendParty(ids) {
  selected = null;
  socket.emit('setParty', { party: ids }, (/** @type {any} */ res) => {
    $('party-error').textContent = res.ok ? '' : res.error;
    renderParty();
  });
}

/** @param {'party'|'storage'} list @param {number} index */
function clickMon(list, index) {
  if (!selected) {
    selected = { list, index };
    renderParty();
    return;
  }
  const first = selected;
  const ids = self.party.map((m) => m.id);
  if (first.list === list && first.index === index) {
    selected = null; // clicked the same one again: deselect
  } else if (first.list === 'party' && list === 'party') {
    [ids[first.index], ids[index]] = [ids[index], ids[first.index]];
    return sendParty(ids);
  } else if (first.list !== list) {
    const partyIndex = first.list === 'party' ? first.index : index;
    const storageIndex = first.list === 'storage' ? first.index : index;
    ids[partyIndex] = self.storage[storageIndex].id;
    return sendParty(ids);
  } else {
    selected = { list, index }; // two storage Mons: just move the selection
  }
  renderParty();
}

/**
 * @param {Mon} mon
 * @param {'party'|'storage'} list
 * @param {number} index
 */
function monRow(mon, list, index) {
  const isSelected = selected?.list === list && selected.index === index;
  const row = el('div', { className: `mon-row${isSelected ? ' selected' : ''}${mon.hp === 0 ? ' fainted' : ''}` });
  if (list === 'party') row.append(el('span', { className: 'slot' }, String(index + 1)));
  row.append(
    monImage(mon.species, 48),
    el('div', { className: 'info' },
      el('b', {}, speciesName(mon.species)), ` HP ${mon.hp}/${mon.maxHp}`,
      hpBar(mon.hp, mon.maxHp),
      el('div', { className: 'stats' }, `ATK ${mon.atk} · DEF ${mon.def} · SPD ${mon.spd}`)),
  );
  const ids = self.party.map((m) => m.id);
  if (list === 'party') {
    const store = el('button', { type: 'button', className: 'secondary', textContent: 'Store' });
    store.disabled = self.party.length <= 1;
    store.addEventListener('click', (e) => {
      e.stopPropagation();
      sendParty(ids.filter((id) => id !== mon.id));
    });
    row.append(store);
  } else {
    const take = el('button', { type: 'button', className: 'secondary', textContent: 'To party' });
    take.disabled = self.party.length >= PARTY_SIZE;
    take.addEventListener('click', (e) => {
      e.stopPropagation();
      sendParty([...ids, mon.id]);
    });
    row.append(take);
  }
  row.addEventListener('click', () => clickMon(list, index));
  return row;
}

function renderParty() {
  $('party-list').replaceChildren(...self.party.map((m, i) => monRow(m, 'party', i)));
  $('storage-title').textContent = `Storage (${self.storage.length})`;
  $('storage-list').replaceChildren(...(self.storage.length
    ? self.storage.map((m, i) => monRow(m, 'storage', i))
    : [el('p', { className: 'empty' }, 'Nothing in storage yet. Mons you catch with a full party land here.')]));
}
