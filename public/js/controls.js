// One set of controls for keyboard and touch.
//
//   Move   WASD (arrow keys work too)   |  on-screen joystick (left thumb)
//   A      Space                         |  A button: talk, confirm, accept
//   B      Escape                        |  B button: back, close, dismiss
//   Party  P                             |  menu icon (top right)
//   Fullscreen                           |  fullscreen button (top right corner)
//   Zoom   - / + or mouse wheel          |  pinch (handled by the world scene)
//
// A and B go to whatever is in front: a message box first, then the top menu,
// then a battle screen, then the world. Menus and scenes register what A and B
// do for them; anything without a B handler just closes on B.

import { $, isDialogOpen, closeDialog, topModal, closeTopModal } from './ui.js';
import { hasTouch, fullscreenSupported, isFullscreen, toggleFullscreen } from './view.js';

/** @typedef {import('/shared/world.js').Dir} Dir */
/** @typedef {{ a?: () => void, b?: () => void }} Actions */
/** @typedef {Actions & { menu?: () => void, zoom?: (factor: number) => void }} WorldActions */

/** @type {Record<string, Dir>} */
const KEY_DIRS = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};
/** How much one press of - / + changes the zoom. */
const ZOOM_STEP = 1.25;

// ---------------------------------------------------------------- direction

/** Keyboard directions held, most recent last. @type {Dir[]} */
const keyHeld = [];
/** @type {Dir | null} */
let stickDir = null;
/** A direction pressed since the world last looked (so a very quick tap still counts). @type {Dir | null} */
let tap = null;

/** The direction being held right now, if any. */
export function heldDirection() {
  return stickDir ?? keyHeld[keyHeld.length - 1] ?? null;
}

export function pendingTap() {
  return tap;
}

export function clearTap() {
  tap = null;
}

/** Forget everything held (a battle started, the window lost focus...). */
export function releaseAll() {
  keyHeld.length = 0;
  tap = null;
  setStick(null);
}

// ---------------------------------------------------------------- A / B routing

/** @type {Map<string, Actions>} */
const modalActions = new Map();
/** @type {Actions | null} */
let sceneActions = null;
/** @type {WorldActions | null} */
let worldActions = null;

/** What A / B do while a given menu overlay is on top. @param {string} id @param {Actions} actions */
export function setModalActions(id, actions) {
  modalActions.set(id, actions);
}

/** What A / B do on a battle screen (null when it closes). @param {Actions | null} actions */
export function setSceneActions(actions) {
  sceneActions = actions;
}

/** What A, the party menu and zoom do in the world (null when it shuts down). @param {WorldActions | null} actions */
export function setWorldActions(actions) {
  worldActions = actions;
}

/** Press A or B. @param {'a'|'b'} button */
export function press(button) {
  if (isDialogOpen()) {
    closeDialog();
    return;
  }
  const top = topModal();
  if (top) {
    const handler = modalActions.get(top)?.[button];
    if (handler) handler();
    else if (button === 'b') closeTopModal();
    return;
  }
  if (sceneActions) {
    sceneActions[button]?.();
    return;
  }
  worldActions?.[button]?.();
}

// ---------------------------------------------------------------- keyboard

/** @param {EventTarget | null} t */
const isTyping = (t) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (!e.repeat) press('b');
    return;
  }
  if (isTyping(e.target)) return;
  const dir = KEY_DIRS[e.code];
  if (dir) {
    e.preventDefault();
    if (!keyHeld.includes(dir)) keyHeld.push(dir);
    tap = dir;
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault(); // and don't "click" a focused button as well
    if (!e.repeat) press('a');
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyP') {
    worldActions?.menu?.();
  } else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') {
    e.preventDefault();
    worldActions?.zoom?.(ZOOM_STEP); // more tiles on screen
  } else if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') {
    e.preventDefault();
    worldActions?.zoom?.(1 / ZOOM_STEP);
  }
});

window.addEventListener('keyup', (e) => {
  const dir = KEY_DIRS[e.code];
  if (!dir) return;
  const i = keyHeld.indexOf(dir);
  if (i >= 0) keyHeld.splice(i, 1);
});

window.addEventListener('blur', releaseAll);

// A clicked button keeps keyboard focus, and Space would "click" it again later.
document.addEventListener('click', (e) => {
  const button = /** @type {Element} */ (e.target)?.closest?.('button');
  if (button instanceof HTMLButtonElement) setTimeout(() => button.blur(), 0);
});

// ---------------------------------------------------------------- touch

const zone = $('stick-zone');
const base = $('stick');
const knob = $('stick-knob');
/** How far the knob can travel, and how far before it counts as a direction (CSS px). */
const STICK_RADIUS = 46;
const DEAD_ZONE = 14;
/** @type {number | null} */
let stickPointer = null;
let center = { x: 0, y: 0 };

/** @param {Dir | null} dir */
function setStick(dir) {
  if (dir && dir !== stickDir) tap = dir;
  stickDir = dir;
  if (!dir && stickPointer === null) {
    knob.style.transform = '';
    base.style.left = '';
    base.style.top = '';
    base.classList.remove('active');
  }
}

/** @param {PointerEvent} e */
function moveStick(e) {
  let dx = e.clientX - center.x;
  let dy = e.clientY - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist > STICK_RADIUS) {
    dx *= STICK_RADIUS / dist;
    dy *= STICK_RADIUS / dist;
  }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  /** @type {Dir | null} */
  let dir = null;
  if (dist >= DEAD_ZONE) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  setStick(dir);
}

// The joystick appears wherever the thumb lands in the left part of the screen.
zone.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (stickPointer !== null) return;
  stickPointer = e.pointerId;
  try {
    zone.setPointerCapture(e.pointerId); // keep tracking the thumb even if it slides off the zone
  } catch {
    /* the pointer is already gone */
  }
  const rect = zone.getBoundingClientRect();
  center = { x: e.clientX, y: e.clientY };
  base.style.left = `${e.clientX - rect.left}px`;
  base.style.top = `${e.clientY - rect.top}px`;
  base.classList.add('active');
  moveStick(e);
});
zone.addEventListener('pointermove', (e) => {
  if (e.pointerId === stickPointer) moveStick(e);
});
const endStick = (/** @type {PointerEvent} */ e) => {
  if (e.pointerId !== stickPointer) return;
  stickPointer = null;
  setStick(null);
};
zone.addEventListener('pointerup', endStick);
zone.addEventListener('pointercancel', endStick);

for (const [id, button] of /** @type {const} */ ([['btn-a', 'a'], ['btn-b', 'b']])) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('pressed');
    press(button);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => el.classList.remove('pressed'));
}
$('btn-menu').addEventListener('click', () => worldActions?.menu?.());

// Fullscreen toggle, like a video player's; entering it also turns to landscape where allowed.
const fullscreenBtn = $('btn-fullscreen');
fullscreenBtn.hidden = !fullscreenSupported();
fullscreenBtn.addEventListener('click', () => toggleFullscreen());
const showFullscreenState = () => document.body.classList.toggle('fullscreen', isFullscreen());
document.addEventListener('fullscreenchange', showFullscreenState);
document.addEventListener('webkitfullscreenchange', showFullscreenState);

// Touch mode: on for any touch screen, and switched on by the first finger touch in any case.
if (hasTouch) document.body.classList.add('touch');
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') document.body.classList.add('touch');
}, { capture: true });
