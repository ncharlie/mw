// The open world: tilemap, buildings, the player, other players, the bot.
// The client predicts its own steps for smooth movement; the server checks
// every step and sends a 'correct' message if it disagrees.

import {
  getWorld, tileAt, isWalkable, DIRS, STEP_MS, TILE_SIZE, WORLD_W, WORLD_H, VIEW_W, VIEW_H,
  BUILDINGS, BOT_NPC, T,
} from '/shared/world.js';
import {
  createTextures, tileFrame, characterTexture, characterFrame, colorsForName, BOT_COLORS,
} from './art.js';
import {
  $, isDialogOpen, closeDialog, showDialog, updateHud, isBlocked, isModalOpen, closeTopModal, closeModal,
} from './ui.js';
import { toggleParty } from './menus.js';
import { showChallenge, hideChallenge, showOrder, hideOrder, opponentLockedIn } from './pvpMenus.js';

/** Screen pixels per art pixel. */
export const ZOOM = 3;
const S = TILE_SIZE;
/** A tap shorter than this only turns the player; holding longer walks. */
const TURN_MS = 110;

/**
 * Camera zoom steps for the world view. ZOOM (the first) is the normal
 * 15 x 11 tile window; each step out shows more of the map, and the last one
 * fits the whole 80 x 80 world. Zoom only changes what this player sees.
 */
const ZOOM_LEVELS = [ZOOM, 2, 1, 0.5];
const ZOOM_KEY = 'monworld.zoom';
/** Ignore extra wheel events for this long after a zoom step (trackpads send many). */
const WHEEL_COOLDOWN_MS = 180;

/** The zoom step this browser used last time (a per-viewer convenience). */
function loadZoomIndex() {
  try {
    const i = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isInteger(i) && i >= 0 && i < ZOOM_LEVELS.length ? i : 0;
  } catch {
    return 0;
  }
}

/** @param {number} i */
function saveZoomIndex(i) {
  try {
    localStorage.setItem(ZOOM_KEY, String(i));
  } catch {
    /* storage blocked: zoom just isn't remembered */
  }
}

/** @type {Record<string, import('/shared/world.js').Dir>} */
const KEY_DIRS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const INTERACT_KEYS = new Set(['KeyE', 'Enter', 'NumpadEnter']);
const CLOSE_KEYS = new Set(['KeyE', 'Enter', 'NumpadEnter', 'Space', 'Escape']);
const ZOOM_OUT_KEYS = new Set(['Minus', 'NumpadSubtract']);
const ZOOM_IN_KEYS = new Set(['Equal', 'NumpadAdd']); // "=" is the "+" key without shift

/**
 * @typedef {object} Character
 * @property {string} name
 * @property {number} x tile position (where it is going, if walking)
 * @property {number} y
 * @property {import('/shared/world.js').Dir} dir
 * @property {number | null} wins null for the bot
 * @property {Phaser.GameObjects.Sprite} sprite
 * @property {Phaser.GameObjects.Text} label
 * @property {Phaser.GameObjects.Image} grass tall-grass blades drawn over the feet
 * @property {Phaser.Tweens.Tween | null} tween
 * @property {boolean} stepToggle alternates left and right foot
 */

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  /** @param {{socket: any, welcome: any}} data */
  init(data) {
    this.socket = data.socket;
    this.welcome = data.welcome;
    this.ready = false;
    /** True from 'wildStart' until the battle screen closes. */
    this.inBattle = false;
    /** @type {any} the running WildScene, once it is ready */
    this.battleScene = null;
    /** Battle messages that arrive before the battle screen is up. @type {[string, any][]} */
    this.battlePending = [];
  }

  create() {
    // After a reconnect, any old battle or match is gone on the server too.
    this.scene.stop('wild');
    this.scene.stop('replay');
    $('battle-panel').hidden = true;
    $('replay-panel').hidden = true;
    hideChallenge();
    hideOrder();
    closeModal('result');
    createTextures(this);
    this.world = getWorld();
    this.drawWorld();

    /** @type {Map<string, Character>} */
    this.others = new Map();
    this.bot = this.addCharacter({ ...BOT_NPC, wins: null }, BOT_COLORS);
    this.me = this.addCharacter(this.welcome.you, colorsForName(this.welcome.you.name));
    for (const p of this.welcome.players) this.addOther(p);

    const cam = this.cameras.main;
    this.zoomIndex = loadZoomIndex();
    cam.setZoom(ZOOM_LEVELS[this.zoomIndex]);
    cam.startFollow(this.me.sprite, true);
    cam.setBackgroundColor('#1d4424');

    this.setupInput();
    this.refreshHud();
    this.ready = true;
  }

  // ------------------------------------------------------------ drawing

  drawWorld() {
    // Endless forest beyond the edge, so the camera can stay centred on the player.
    // Wide enough for the furthest zoom-out with the player at the very edge.
    const minZoom = Math.min(...ZOOM_LEVELS);
    const pad = Math.ceil((Math.max(VIEW_W, VIEW_H) * ZOOM) / minZoom / 2) + 2;
    this.add
      .tileSprite(-pad * S, -pad * S, (WORLD_W + pad * 2) * S, (WORLD_H + pad * 2) * S, 'tree-tile')
      .setOrigin(0)
      .setDepth(-1);

    const rows = [];
    for (let y = 0; y < this.world.h; y++) {
      const row = [];
      for (let x = 0; x < this.world.w; x++) row.push(tileFrame(tileAt(this.world, x, y), x, y));
      rows.push(row);
    }
    const map = this.make.tilemap({ data: rows, tileWidth: S, tileHeight: S });
    const tileset = /** @type {Phaser.Tilemaps.Tileset} */ (map.addTilesetImage('tiles'));
    map.createLayer(0, tileset, 0, 0)?.setDepth(0);

    for (const b of BUILDINGS) {
      this.add.image(b.x * S, b.y * S, `building-${b.id}`).setOrigin(0).setDepth(1);
    }
  }

  /**
   * @param {{name: string, x: number, y: number, dir: any, wins: number | null}} info
   * @param {Parameters<typeof characterTexture>[1]} colors
   * @returns {Character}
   */
  addCharacter(info, colors) {
    const sprite = this.add.sprite(0, 0, characterTexture(this, colors), 0).setDepth(3);
    const label = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '6px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#22202a',
        strokeThickness: 2,
        resolution: ZOOM,
      })
      .setOrigin(0.5, 1)
      .setDepth(5);
    const grass = this.add.image(0, 0, 'grass-front').setOrigin(0).setDepth(4).setVisible(false);
    /** @type {Character} */
    const ch = { ...info, sprite, label, grass, tween: null, stepToggle: false };
    this.setLabel(ch);
    this.placeCharacter(ch, info.x, info.y, info.dir);
    return ch;
  }

  /** @param {Character} ch */
  setLabel(ch) {
    ch.label.setText(ch.wins === null ? ch.name : `${ch.name} ★${ch.wins}`);
  }

  /** @param {Character} ch @param {number} step 0 stand, 1 or 2 walking */
  setFrame(ch, step) {
    const f = characterFrame(ch.dir, step);
    ch.sprite.setFrame(f.frame).setFlipX(f.flipX);
  }

  /** Show the tall-grass overlay if the character stands in tall grass. @param {Character} ch */
  updateGrass(ch) {
    const inGrass = tileAt(this.world, ch.x, ch.y) === T.TALL_GRASS;
    ch.grass.setVisible(inGrass).setPosition(ch.x * S, ch.y * S);
  }

  /** Jump straight to a tile, no animation. @param {Character} ch */
  placeCharacter(ch, x, y, dir) {
    ch.tween?.stop();
    ch.tween = null;
    Object.assign(ch, { x, y, dir });
    ch.sprite.setPosition(x * S + S / 2, y * S + S / 2);
    this.setFrame(ch, 0);
    this.updateGrass(ch);
  }

  /**
   * Walk one tile with a short tween.
   * @param {Character} ch
   * @param {() => void} [onDone]
   */
  walkCharacter(ch, x, y, dir, onDone) {
    ch.tween?.stop();
    Object.assign(ch, { x, y, dir });
    ch.stepToggle = !ch.stepToggle;
    this.setFrame(ch, ch.stepToggle ? 1 : 2);
    this.updateGrass(ch);
    const tween = this.tweens.add({
      targets: ch.sprite,
      x: x * S + S / 2,
      y: y * S + S / 2,
      duration: STEP_MS,
      onUpdate: (tw) => {
        if (tw.progress >= 0.5) this.setFrame(ch, 0);
      },
      onComplete: () => {
        if (ch.tween === tween) ch.tween = null;
        this.setFrame(ch, 0);
        onDone?.();
      },
    });
    ch.tween = tween;
  }

  // ------------------------------------------------------------ other players

  /** @param {{name: string, x: number, y: number, dir: any, wins: number}} p */
  addOther(p) {
    this.removeOther(p.name);
    this.others.set(p.name, this.addCharacter(p, colorsForName(p.name)));
  }

  /** @param {string} name */
  removeOther(name) {
    const ch = this.others.get(name);
    if (!ch) return;
    ch.tween?.stop();
    ch.sprite.destroy();
    ch.label.destroy();
    ch.grass.destroy();
    this.others.delete(name);
  }

  refreshHud() {
    updateHud(this.me.name, this.others.size + 1);
  }

  /** Called by main.js for every server message. @param {string} event @param {any} data */
  onNet(event, data) {
    switch (event) {
      case 'playerJoined':
        this.addOther(data);
        this.refreshHud();
        break;
      case 'playerLeft':
        this.removeOther(data.name);
        this.refreshHud();
        break;
      case 'playerMoved': {
        const ch = this.others.get(data.name);
        if (!ch) return;
        const dist = Math.abs(data.x - ch.x) + Math.abs(data.y - ch.y);
        if (dist === 1) this.walkCharacter(ch, data.x, data.y, data.dir);
        else if (dist > 1) this.placeCharacter(ch, data.x, data.y, data.dir);
        else if (!ch.tween) this.placeCharacter(ch, data.x, data.y, data.dir);
        else ch.dir = data.dir;
        ch.wins = data.wins;
        this.setLabel(ch);
        break;
      }
      case 'correct':
        this.placeCharacter(this.me, data.x, data.y, data.dir);
        break;
      case 'message':
        showDialog(data.text);
        break;
      case 'wildStart':
        this.startBattle(data);
        break;
      case 'wildRound':
      case 'wildThrow':
      case 'wildEnd':
        if (this.battleScene) this.battleScene.onNet(event, data);
        else this.battlePending.push([event, data]);
        break;

      // ---- PvP and bot matches
      case 'wins': {
        const ch = data.name === this.me.name ? this.me : this.others.get(data.name);
        if (ch) {
          ch.wins = data.wins;
          this.setLabel(ch);
        }
        break;
      }
      case 'challenge':
        this.beginMatch();
        showChallenge('incoming', data.from, data.seconds);
        break;
      case 'challengeSent':
        this.beginMatch();
        showChallenge('outgoing', data.to, data.seconds);
        break;
      case 'challengeClosed':
        hideChallenge();
        this.inBattle = false;
        if (data.text) showDialog(data.text);
        break;
      case 'pvpOrder':
        hideChallenge();
        this.beginMatch();
        showOrder(data);
        break;
      case 'pvpLocked':
        opponentLockedIn();
        break;
      case 'pvpCancelled':
        hideChallenge();
        hideOrder();
        this.inBattle = false;
        showDialog(data.text);
        break;
      case 'pvpResult':
        hideOrder();
        this.startReplay(data);
        break;
    }
  }

  // ------------------------------------------------------------ PvP and bot matches

  /** A challenge or match is starting: stop walking and close other menus. */
  beginMatch() {
    this.inBattle = true;
    this.held = [];
    this.tapped = null;
    closeDialog();
    closeModal('shop');
    closeModal('party');
  }

  /** @param {any} result the 'pvpResult' message */
  startReplay(result) {
    this.inBattle = true;
    this.cameras.main.flash(350, 255, 255, 255);
    this.time.delayedCall(380, () => this.scene.launch('replay', { world: this, result }));
  }

  /** The player closed the result screen. */
  endMatch() {
    this.inBattle = false;
    this.held = [];
    this.tapped = null;
    this.socket.emit('pvpDone');
    this.cameras.main.fadeIn(250, 0, 0, 0);
  }

  // ------------------------------------------------------------ wild battles

  /** @param {any} start the 'wildStart' payload */
  startBattle(start) {
    this.inBattle = true;
    this.held = [];
    this.tapped = null;
    this.battlePending = [];
    closeDialog();
    // A quick white flash, then the battle screen takes over the canvas.
    this.cameras.main.flash(350, 255, 255, 255);
    this.time.delayedCall(380, () => {
      this.scene.launch('wild', {
        world: this,
        start,
        colors: colorsForName(this.me.name),
        pending: this.battlePending,
      });
    });
  }

  /** Called by the battle screen when it closes. @param {string} _result */
  endBattle(_result) {
    this.inBattle = false;
    this.battleScene = null;
    this.battlePending = [];
    this.held = [];
    this.tapped = null;
    this.cameras.main.fadeIn(250, 0, 0, 0);
  }

  // ------------------------------------------------------------ input and movement

  setupInput() {
    /** Directions currently held, most recent last. @type {import('/shared/world.js').Dir[]} */
    this.held = [];
    /** A key pressed since the last check. @type {import('/shared/world.js').Dir | null} */
    this.tapped = null;
    this.turnUntil = 0;
    this.lastStepEnd = -1000;

    const onDown = (/** @type {KeyboardEvent} */ e) => {
      if (e.code === 'Escape') {
        if (!closeTopModal() && isDialogOpen()) closeDialog();
        return;
      }
      const target = e.target;
      // Typing in a menu field, or pressing a focused menu button: leave it to the browser.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLButtonElement && INTERACT_KEYS.has(e.code)) return;

      const dir = KEY_DIRS[e.code];
      if (dir) {
        e.preventDefault();
        if (!this.held.includes(dir)) this.held.push(dir);
        this.tapped = dir; // remembered even if released before the next frame
        return;
      }
      if (e.code === 'KeyP') {
        if (!e.repeat) this.openPartyMenu();
        return;
      }
      // By key position or by the character typed, so other keyboard layouts work too.
      const zoomOut = ZOOM_OUT_KEYS.has(e.code) || e.key === '-';
      const zoomIn = ZOOM_IN_KEYS.has(e.code) || e.key === '+' || e.key === '=';
      if (zoomOut || zoomIn) {
        e.preventDefault();
        if (!e.repeat && !isBlocked()) this.changeZoom(zoomOut ? 1 : -1);
        return;
      }
      if (!CLOSE_KEYS.has(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (isDialogOpen()) closeDialog();
      else if (INTERACT_KEYS.has(e.code)) this.interact();
    };
    // Mouse wheel / trackpad over the map: scroll down zooms out, up zooms in.
    let lastWheel = 0;
    this.input.on('wheel', (/** @type {any} */ _p, /** @type {any} */ _o, /** @type {number} */ _dx, /** @type {number} */ dy) => {
      const now = this.time.now;
      if (dy === 0 || isBlocked() || now - lastWheel < WHEEL_COOLDOWN_MS) return;
      lastWheel = now;
      this.changeZoom(dy > 0 ? 1 : -1);
    });
    /** @type {HTMLButtonElement} */ ($('hud-party')).onclick = (e) => {
      this.openPartyMenu();
      /** @type {HTMLElement} */ (e.currentTarget).blur();
    };
    const onUp = (/** @type {KeyboardEvent} */ e) => {
      const dir = KEY_DIRS[e.code];
      if (dir) this.held = this.held.filter((d) => d !== dir);
    };
    const onBlur = () => {
      this.held = [];
      this.tapped = null;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  interact() {
    if (this.me.tween || this.inBattle || isBlocked()) return;
    this.socket.emit('interact');
  }

  /** P key / HUD button: open or close the party menu, unless something else is going on. */
  openPartyMenu() {
    if (this.inBattle || isDialogOpen()) return;
    if (isModalOpen('party') || !isBlocked()) toggleParty();
  }

  update() {
    // Name labels keep the same size on screen at any zoom, so they stay readable.
    const labelScale = ZOOM / this.cameras.main.zoom;
    for (const ch of [this.me, this.bot, ...this.others.values()]) {
      ch.label.setPosition(ch.sprite.x, ch.sprite.y - S / 2 - 1).setScale(labelScale);
    }
    this.handleInput();
  }

  /** Step the camera zoom in (-1) or out (+1). @param {number} step */
  changeZoom(step) {
    if (this.inBattle) return;
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.zoomIndex + step));
    if (next === this.zoomIndex) return;
    this.zoomIndex = next;
    this.cameras.main.zoomTo(ZOOM_LEVELS[next], 200, 'Sine.easeInOut', true);
    saveZoomIndex(next);
  }

  /** Decide whether to turn or step, based on the keys held right now. */
  handleInput() {
    const me = this.me;
    if (me.tween) return;
    if (isBlocked() || this.inBattle) {
      this.tapped = null;
      return;
    }
    const heldDir = this.held[this.held.length - 1];
    const dir = heldDir ?? this.tapped;
    if (!dir) return;
    const now = this.time.now;
    const stillWalking = now - this.lastStepEnd < 60;

    // From standing still, a new direction first turns the player on the spot.
    if (dir !== me.dir && !stillWalking) {
      this.tapped = null;
      this.face(dir);
      this.turnUntil = now + TURN_MS;
      return;
    }
    if (heldDir && now < this.turnUntil) return;
    this.tapped = null;

    const nx = me.x + DIRS[dir].dx;
    const ny = me.y + DIRS[dir].dy;
    if (!isWalkable(this.world, nx, ny)) {
      this.face(dir);
      return;
    }
    this.socket.emit('move', { dir, x: nx, y: ny });
    this.walkCharacter(me, nx, ny, dir, () => {
      this.lastStepEnd = this.time.now;
      this.handleInput(); // keep walking without a one-frame pause
    });
  }

  /** @param {import('/shared/world.js').Dir} dir */
  face(dir) {
    if (this.me.dir === dir) return;
    this.me.dir = dir;
    this.setFrame(this.me, 0);
    this.socket.emit('face', { dir });
  }
}
