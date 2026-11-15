// Small helpers for the HTML overlays: message box, HUD, and which menu is open.

/** @param {string} id */
export const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Build an element: el('div', { className: 'x' }, child, 'text', ...) */
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------- message box

const dialog = $('dialog');
const dialogText = $('dialog-text');
dialog.addEventListener('click', closeDialog);

/** Show a message box. The player can't walk until it is closed. @param {string} text */
export function showDialog(text) {
  dialogText.textContent = text;
  dialog.hidden = false;
}

export function closeDialog() {
  dialog.hidden = true;
}

export function isDialogOpen() {
  return !dialog.hidden;
}

// ---------------------------------------------------------------- menus

/** Ids of open menu overlays, in the order they were opened. */
const openModals = [];
/** Menus that can't be closed with Escape. */
const STICKY = new Set(['starter', 'challenge', 'order', 'result']);

/** @param {string} id */
export function openModal(id) {
  $(id).hidden = false;
  if (!openModals.includes(id)) openModals.push(id);
}

/** @param {string} id */
export function closeModal(id) {
  $(id).hidden = true;
  const i = openModals.indexOf(id);
  if (i >= 0) openModals.splice(i, 1);
  // Don't leave focus on a hidden input: the world would think we're typing.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** @param {string} id */
export function isModalOpen(id) {
  return openModals.includes(id);
}

/** The menu overlay on top, if any. */
export function topModal() {
  return openModals.at(-1) ?? null;
}

/** Close the most recent menu (Escape). Returns true if something closed. */
export function closeTopModal() {
  const top = openModals.at(-1);
  if (!top || STICKY.has(top)) return false;
  closeModal(top);
  return true;
}

/** Is anything in the way of walking around? */
export function isBlocked() {
  return isDialogOpen() || openModals.length > 0;
}

// ---------------------------------------------------------------- HUD

/** @param {string} name @param {number} onlineCount */
export function updateHud(name, onlineCount) {
  $('hud-name').textContent = name;
  $('hud-online').textContent = `${onlineCount} online`;
}

/** @param {{coins: number, shackles: number}} self */
export function updateWallet(self) {
  $('hud-coins').textContent = `${self.coins} coins`;
  $('hud-shackles').textContent = `${self.shackles} shackles`;
}

/** @param {boolean} visible */
export function showHud(visible) {
  $('hud').hidden = !visible;
  $('help').hidden = !visible;
}

/**
 * An HP bar element.
 * @param {number} hp
 * @param {number} maxHp
 */
export function hpBar(hp, maxHp) {
  const pct = Math.round((100 * hp) / maxHp);
  const bar = el('div', { className: `hp-bar${pct <= 20 ? ' low' : pct <= 50 ? ' mid' : ''}` });
  bar.append(el('span', { style: `width: ${pct}%` }));
  return bar;
}
