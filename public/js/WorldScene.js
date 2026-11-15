// The open world: tilemap, buildings, the player, other players, the bot.
// The client predicts its own steps for smooth movement; the server checks
// every step and sends a 'correct' message if it disagrees.

import {
  getWorld, tileAt, isWalkable, DIRS, STEP_MS, TILE_SIZE, WORLD_W, WORLD_H, BUILDINGS, BOT_NPC, T,
} from '/shared/world.js';
import {
  createTextures, tileFrame, characterTexture, characterFrame, colorsForName, BOT_COLORS,
} from './art.js';
import {
  $, isDialogOpen, closeDialog, showDialog, updateHud, isBlocked, isModalOpen, closeModal,
} from './ui.js';
import { toggleParty } from './menus.js';
import { showChallenge, hideChallenge, showOrder, hideOrder, opponentLockedIn } from './pvpMenus.js';
import {
  heldDirection, pendingTap, clearTap, releaseAll, setWorldActions,
} from './controls.js';
import { TEXT_RES } from './view.js';

const S = TILE_SIZE;
/** A tap shorter than this only turns the player; holding longer walks. */
const TURN_MS = 110;

/**
 * Zoom is set by how many tiles fit across the screen, so it means the same on
 * a phone and a wide monitor. Zoom only changes what this player sees.
 */
export const MIN_TILES = 20; // most zoomed in
export const MAX_TILES = 45; // most zoomed out
const DEFAULT_TILES = MIN_TILES;
const ZOOM_KEY = 'monworld.tilesWide';

/** The zoom this browser used last time (a per-viewer convenience). */
function loadTiles() {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY));
    return n >= MIN_TILES && n <= MAX_TILES ? n : DEFAULT_TILES;
  } catch {
    return DEFAULT_TILES;
  }
}

/** @param {number} n */
function saveTiles(n) {
  try {
    localStorage.setItem(ZOOM_KEY, String(Math.round(n * 100) / 100));
  } catch {
    /* storage blocked: zoom just isn't remembered */
  }
}

/** @param {TouchList} t */
const touchDistance = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

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
    this.tilesWide = loadTiles();
    this.applyZoom();
    cam.startFollow(this.me.sprite, true);
    cam.setBackgroundColor('#1d4424');
    const onResize = () => this.applyZoom();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));

    this.setupInput();
    this.refreshHud();
    document.body.classList.add('playing');
    this.ready = true;
  }

  // ------------------------------------------------------------ drawing

  drawWorld() {
    // Endless forest beyond the edge, so the camera can stay centred on the player.
    // Big enough for the furthest zoom-out, even on a tall window (up to 2.5:1).
    const pad = Math.ceil((MAX_TILES * 2.5) / 2) + 2;
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
        resolution: TEXT_RES,
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
    releaseAll();
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
    releaseAll();
    this.socket.emit('pvpDone');
    this.cameras.main.fadeIn(250, 0, 0, 0);
  }

  // ------------------------------------------------------------ wild battles

  /** @param {any} start the 'wildStart' payload */
  startBattle(start) {
    this.inBattle = true;
    releaseAll();
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
    releaseAll();
    this.cameras.main.fadeIn(250, 0, 0, 0);
  }

  // ------------------------------------------------------------ input and movement

  setupInput() {
    this.turnUntil = 0;
    this.lastStepEnd = -1000;
    releaseAll();

    // Keyboard and touch buttons come through controls.js; this is what they do here.
    setWorldActions({
      a: () => this.interact(),
      menu: () => this.openPartyMenu(),
      zoom: (factor) => this.setTiles(this.tilesWide * factor, true),
    });
    /** @type {HTMLButtonElement} */ ($('hud-party')).onclick = () => this.openPartyMenu();

    // Mouse wheel / trackpad: scroll down to zoom out. Smooth on trackpads, a step per notch on wheels.
    this.input.on('wheel', (/** @type {any} */ _p, /** @type {any} */ _o, /** @type {number} */ _dx, /** @type {number} */ dy) => {
      if (dy === 0 || isBlocked() || this.inBattle) return;
      const clamped = Math.max(-100, Math.min(100, dy));
      this.setTiles(this.tilesWide * Math.exp(clamped * 0.002));
    });

    // Two fingers on the map: pinch to zoom.
    const canvas = this.game.canvas;
    /** @type {{ dist: number, tiles: number } | null} */
    let pinch = null;
    const onTouchStart = (/** @type {TouchEvent} */ e) => {
      if (e.targetTouches.length === 2) pinch = { dist: touchDistance(e.targetTouches), tiles: this.tilesWide };
    };
    const onTouchMove = (/** @type {TouchEvent} */ e) => {
      if (!pinch || e.targetTouches.length !== 2) return;
      e.preventDefault();
      if (isBlocked() || this.inBattle) return;
      // Fingers closer together = see more tiles.
      this.setTiles((pinch.tiles * pinch.dist) / Math.max(1, touchDistance(e.targetTouches)));
    };
    const onTouchEnd = (/** @type {TouchEvent} */ e) => {
      if (e.targetTouches.length < 2) pinch = null;
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    this.events.once('shutdown', () => {
      setWorldActions(null);
      document.body.classList.remove('playing');
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    });
  }

  /** Camera zoom that fits `tilesWide` tiles across the canvas. */
  applyZoom() {
    this.cameras.main.setZoom(this.scale.width / (this.tilesWide * S));
  }

  /**
   * Zoom so that `n` tiles fit across the screen (clamped to 20..45).
   * @param {number} n
   * @param {boolean} [animate] glide there (keys); pinch and wheel follow the fingers directly
   */
  setTiles(n, animate = false) {
    const tiles = Math.max(MIN_TILES, Math.min(MAX_TILES, n));
    if (tiles === this.tilesWide) return;
    this.tilesWide = tiles;
    const zoom = this.scale.width / (tiles * S);
    if (animate) this.cameras.main.zoomTo(zoom, 150, 'Sine.easeInOut', true);
    else this.cameras.main.setZoom(zoom);
    saveTiles(tiles);
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
    // Name labels are part of the map, so they shrink and grow with the zoom.
    for (const ch of [this.me, this.bot, ...this.others.values()]) {
      ch.label.setPosition(ch.sprite.x, ch.sprite.y - S / 2 - 1);
    }
    this.handleInput();
  }

  /** Decide whether to turn or step, based on the keys / joystick held right now. */
  handleInput() {
    const me = this.me;
    if (me.tween) return;
    if (isBlocked() || this.inBattle) {
      clearTap();
      return;
    }
    const heldDir = heldDirection();
    const dir = heldDir ?? pendingTap();
    if (!dir) return;
    const now = this.time.now;
    const stillWalking = now - this.lastStepEnd < 60;

    // From standing still, a new direction first turns the player on the spot.
    if (dir !== me.dir && !stillWalking) {
      clearTap();
      this.face(dir);
      this.turnUntil = now + TURN_MS;
      return;
    }
    if (heldDir && now < this.turnUntil) return;
    clearTap();

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
