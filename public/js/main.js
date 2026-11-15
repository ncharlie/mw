// Client entry point: login screen -> Socket.IO connection -> Phaser game.

import { VIEW_W, VIEW_H, TILE_SIZE } from '/shared/world.js';
import { WorldScene, ZOOM } from './WorldScene.js';
import { WildScene } from './WildScene.js';
import { ReplayScene } from './ReplayScene.js';
import { setPvpSocket } from './pvpMenus.js';
import { showHud, closeDialog, closeModal, updateWallet } from './ui.js';
import { setSocket, setSelf, showStarter, openShop } from './menus.js';

/* global Phaser, io */

// sessionStorage is per tab, so two tabs can be logged in as two different players.
const TOKEN_KEY = 'monworld.token';
/** Server events that are handed straight to the world scene. */
const WORLD_EVENTS = [
  'playerJoined', 'playerLeft', 'playerMoved', 'correct', 'message',
  'wildStart', 'wildRound', 'wildThrow', 'wildEnd',
  'wins', 'challenge', 'challengeSent', 'challengeClosed',
  'pvpOrder', 'pvpLocked', 'pvpCancelled', 'pvpResult',
];

const loginEl = /** @type {HTMLElement} */ (document.getElementById('login'));
const form = /** @type {HTMLFormElement} */ (document.getElementById('login-form'));
const userInput = /** @type {HTMLInputElement} */ (document.getElementById('login-user'));
const passInput = /** @type {HTMLInputElement} */ (document.getElementById('login-pass'));
const errorEl = /** @type {HTMLElement} */ (document.getElementById('login-error'));

/** sessionStorage can be blocked (strict privacy settings); then the token lives only in memory. */
const tokenStore = {
  memory: /** @type {string | null} */ (null),
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return this.memory; }
  },
  set(/** @type {string} */ token) {
    this.memory = token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* memory only */ }
  },
  clear() {
    this.memory = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* memory only */ }
  },
};

/** @type {any} */
let socket = null;
/** @type {Phaser.Game | null} */
let game = null;

function showLogin(message = '') {
  stopGame();
  showHud(false);
  closeDialog();
  for (const id of ['starter', 'shop', 'party', 'challenge', 'order', 'result']) closeModal(id);
  loginEl.hidden = false;
  errorEl.textContent = message;
  userInput.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = /** @type {HTMLButtonElement} */ (form.querySelector('button'));
  button.disabled = true;
  errorEl.textContent = '';
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userInput.value, password: passInput.value }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed.');
    tokenStore.set(body.token);
    passInput.value = '';
    connect(body.token);
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});

/** @param {string} token */
function connect(token) {
  socket?.disconnect();
  socket = io({ auth: { token } });

  socket.on('connect_error', (/** @type {Error} */ err) => {
    if (err.message !== 'unauthorized') return; // network trouble: Socket.IO keeps retrying
    tokenStore.clear();
    socket.disconnect();
    showLogin('Your session ended. Please log in again.');
  });

  socket.on('kicked', (/** @type {{reason: string}} */ msg) => {
    tokenStore.clear();
    socket.disconnect();
    showLogin(msg.reason);
  });

  // Sent on every (re)connect with the full current state.
  socket.on('welcome', (welcome) => {
    loginEl.hidden = true;
    (/** @type {HTMLElement} */ (document.activeElement))?.blur?.();
    showHud(true);
    setSocket(socket);
    setPvpSocket(socket);
    applySelf(welcome.self);
    startWorld({ socket, welcome });
    if (welcome.self.party.length === 0) showStarter();
  });

  // The player's own coins, shackles, party and storage changed.
  socket.on('self', applySelf);
  socket.on('openShop', (/** @type {{price: number}} */ msg) => openShop(msg.price));

  for (const event of WORLD_EVENTS) {
    socket.on(event, (data) => {
      const scene = /** @type {WorldScene | undefined} */ (game?.scene.getScene('world'));
      if (scene?.ready && scene.sys.isActive()) scene.onNet(event, data);
    });
  }
}

/** @param {{socket: any, welcome: any}} data */
function startWorld(data) {
  if (!game) {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: VIEW_W * TILE_SIZE * ZOOM,
      height: VIEW_H * TILE_SIZE * ZOOM,
      pixelArt: true,
      backgroundColor: '#15161c',
      audio: { noAudio: true }, // no sound in v1
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
    game.scene.add('world', WorldScene, true, data);
    game.scene.add('wild', WildScene, false); // added after the world, so they draw on top
    game.scene.add('replay', ReplayScene, false);
    return;
  }
  game.scene.start('world', data); // restarts it if already running
}

/** @param {any} self */
function applySelf(self) {
  setSelf(self);
  updateWallet(self);
}

function stopGame() {
  game?.destroy(true);
  game = null;
}

const saved = tokenStore.get();
if (saved) connect(saved);
else showLogin();
