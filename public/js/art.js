// All placeholder pixel art, drawn in code into canvas textures.
// No image files are needed. Everything here is original.

import { createRng } from '/shared/rng.js';
import { T, TILE_SIZE, BUILDINGS } from '/shared/world.js';

const S = TILE_SIZE;
const OUTLINE = '#2b2a33';

/** Tileset frame indexes. 0-7 match the tile ids in shared/world.js; the rest are variants. */
const GROUND_B = 8;
const TALL_GRASS_B = 9;
const TILESET_FRAMES = 10;

/** Create every shared texture once per game. @param {Phaser.Scene} scene */
export function createTextures(scene) {
  if (scene.textures.exists('tiles')) return;
  makeTileset(scene);
  makeSingleTile(scene, 'tree-tile', (ctx) => drawTree(ctx, 0));
  makeSingleTile(scene, 'grass-front', drawGrassFront);
  for (const b of BUILDINGS) makeBuilding(scene, b);
}

/**
 * Which tileset frame to draw at (x, y). Adds variety without changing the map.
 * @param {number} tile
 * @param {number} x
 * @param {number} y
 */
export function tileFrame(tile, x, y) {
  const odd = (x * 7 + y * 13 + ((x * y) % 5)) % 3 === 0;
  if (tile === T.GROUND && odd) return GROUND_B;
  if (tile === T.TALL_GRASS && odd) return TALL_GRASS_B;
  return tile;
}

// ---------------------------------------------------------------- helpers

/** @param {CanvasRenderingContext2D} ctx */
function px(ctx, x, y, color, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Paint a picture given as rows of characters, using a palette map. */
function paint(ctx, rows, palette, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (color) px(ctx, ox + x, oy + y, color);
    }
  });
}

function speckle(ctx, ox, rng, color, count) {
  for (let i = 0; i < count; i++) px(ctx, ox + Math.floor(rng() * S), Math.floor(rng() * S), color);
}

function makeSingleTile(scene, key, draw) {
  const tex = scene.textures.createCanvas(key, S, S);
  draw(tex.getContext());
  tex.refresh();
}

// ---------------------------------------------------------------- tiles

function makeTileset(scene) {
  const tex = scene.textures.createCanvas('tiles', S * TILESET_FRAMES, S);
  const ctx = tex.getContext();
  const draw = {
    [T.GROUND]: (ox) => drawGround(ctx, ox, 1),
    [T.PATH]: (ox) => drawPath(ctx, ox),
    [T.TALL_GRASS]: (ox) => drawTallGrass(ctx, ox, 0),
    [T.TREE]: (ox) => drawTree(ctx, ox),
    [T.WATER]: (ox) => drawWater(ctx, ox),
    [T.DIRT]: (ox) => drawDirt(ctx, ox),
    [T.BUILDING]: (ox) => drawGround(ctx, ox, 1),
    [T.FLOWERS]: (ox) => drawFlowers(ctx, ox),
    [GROUND_B]: (ox) => drawGround(ctx, ox, 2),
    [TALL_GRASS_B]: (ox) => drawTallGrass(ctx, ox, 1),
  };
  for (let i = 0; i < TILESET_FRAMES; i++) draw[i](i * S);
  tex.refresh();
}

function drawGround(ctx, ox, seed) {
  const rng = createRng(100 + seed);
  px(ctx, ox, 0, '#8fd16a', S, S);
  speckle(ctx, ox, rng, '#78bb57', 10);
  speckle(ctx, ox, rng, '#a9e283', 5);
}

function drawPath(ctx, ox) {
  const rng = createRng(200);
  px(ctx, ox, 0, '#e6d29a', S, S);
  speckle(ctx, ox, rng, '#d4bd80', 14);
  for (let i = 0; i < 3; i++) {
    px(ctx, ox + 1 + Math.floor(rng() * 13), 1 + Math.floor(rng() * 13), '#b99f66', 2, 1);
  }
}

const TUFT = ['l...l', 'dl.ld', '.dld.', '.ddd.'];
const TUFT_COLORS = { l: '#86d460', d: '#2f6b2b' };

function drawTallGrass(ctx, ox, variant) {
  px(ctx, ox, 0, '#4c9a3c', S, S);
  const spots = variant === 0
    ? [[1, 1], [9, 0], [5, 6], [11, 7], [0, 11], [8, 12]]
    : [[3, 2], [10, 4], [0, 7], [6, 9], [11, 12], [2, 12]];
  for (const [x, y] of spots) paint(ctx, TUFT, TUFT_COLORS, ox + x, y);
}

function drawTree(ctx, ox) {
  px(ctx, ox, 0, '#4c9a3c', S, S); // trees only grow in the wilderness, among tall grass
  // shadow + trunk
  px(ctx, ox + 4, 15, '#3d8231', 8, 1);
  px(ctx, ox + 6, 11, OUTLINE, 4, 5);
  px(ctx, ox + 7, 11, '#7a4e2a', 2, 4);
  // round canopy
  const cx = 7.5;
  const cy = 6.2;
  const r = 6.6;
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      let color = '#2e7a3a';
      if (d > r - 1.1) color = '#1d4424';
      else if (Math.hypot(x - 5, y - 3.5) < 2.4) color = '#4fa552';
      else if (y > cy + 2 || x > cx + 3) color = '#256431';
      px(ctx, ox + x, y, color);
    }
  }
}

function drawWater(ctx, ox) {
  const rng = createRng(300);
  px(ctx, ox, 0, '#3f86d8', S, S);
  speckle(ctx, ox, rng, '#3473bf', 10);
  for (const [x, y] of [[2, 3], [9, 6], [4, 11], [11, 13]]) {
    px(ctx, ox + x, y, '#8cc6f6', 3, 1);
    px(ctx, ox + x + 3, y - 1, '#8cc6f6', 1, 1);
  }
}

function drawDirt(ctx, ox) {
  const rng = createRng(400);
  px(ctx, ox, 0, '#b98a58', S, S);
  speckle(ctx, ox, rng, '#9c7045', 14);
  speckle(ctx, ox, rng, '#d0a574', 8);
}

function drawFlowers(ctx, ox) {
  drawGround(ctx, ox, 1);
  const flowers = [[3, 3, '#e85a5a'], [11, 5, '#ffffff'], [6, 11, '#e86ab0']];
  for (const [x, y, petal] of flowers) {
    px(ctx, ox + x, y - 1, petal);
    px(ctx, ox + x, y + 1, petal);
    px(ctx, ox + x - 1, y, petal);
    px(ctx, ox + x + 1, y, petal);
    px(ctx, ox + x, y, '#f6d64a');
  }
}

/** The front blades of tall grass, drawn over a character's feet. */
function drawGrassFront(ctx) {
  for (let x = 0; x < S; x++) {
    const top = x % 3 === 1 ? 9 : 10;
    px(ctx, x, top, '#86d460');
    px(ctx, x, top + 1, '#4c9a3c', 1, S - top - 1);
  }
  for (let x = 1; x < S; x += 4) px(ctx, x, 12, '#2f6b2b', 2, 3);
}

// ---------------------------------------------------------------- buildings

const BUILDING_STYLE = {
  hospital: { roof: '#3fa7a0', roofDark: '#2e7f79', wall: '#f4f1ea' },
  shop: { roof: '#e0922f', roofDark: '#b06f1d', wall: '#efe2c2' },
  house1: { roof: '#b6503c', roofDark: '#8b3b2c', wall: '#efe2c2' },
  house2: { roof: '#5a7fc2', roofDark: '#42619a', wall: '#efe2c2' },
  house3: { roof: '#6f9a45', roofDark: '#557835', wall: '#efe2c2' },
};

/** @param {Phaser.Scene} scene @param {import('/shared/world.js').Building} b */
function makeBuilding(scene, b) {
  const W = b.w * S;
  const H = b.h * S;
  const style = BUILDING_STYLE[b.id] ?? BUILDING_STYLE.house1;
  const tex = scene.textures.createCanvas(`building-${b.id}`, W, H);
  const ctx = tex.getContext();
  const roofH = Math.round(H * 0.45);

  // Wall
  px(ctx, 0, roofH, OUTLINE, W, H - roofH);
  px(ctx, 1, roofH, style.wall, W - 2, H - roofH - 1);
  px(ctx, 1, H - 4, '#c9b48f', W - 2, 3);

  // Roof with rows of shingles
  px(ctx, 0, 0, OUTLINE, W, roofH);
  px(ctx, 1, 1, style.roof, W - 2, roofH - 2);
  for (let y = 4, row = 0; y < roofH - 2; y += 4, row++) {
    px(ctx, 1, y, style.roofDark, W - 2, 1);
    for (let x = 3 + (row % 2) * 3; x < W - 2; x += 6) px(ctx, x, y - 3, style.roofDark, 1, 3);
  }
  px(ctx, 1, roofH - 2, style.roofDark, W - 2, 1);

  // Windows on either side of the door
  const doorCol = b.door.x - b.x;
  for (const col of [doorCol - 2, doorCol + 1]) {
    if (col < 0 || col >= b.w) continue;
    const wx = col * S + 3;
    const wy = roofH + 5;
    px(ctx, wx, wy, OUTLINE, 10, 8);
    px(ctx, wx + 1, wy + 1, '#a7d8f2', 8, 6);
    px(ctx, wx + 1, wy + 1, '#e6f6ff', 3, 1);
    px(ctx, wx + 5, wy + 1, OUTLINE, 1, 6);
  }

  // Door
  const dx = doorCol * S;
  px(ctx, dx + 3, H - 13, OUTLINE, 10, 13);
  px(ctx, dx + 4, H - 12, '#8a5530', 8, 12);
  px(ctx, dx + 7, H - 12, '#6e4224', 1, 12);
  px(ctx, dx + 10, H - 7, '#f2d14a');

  // Signs above the door
  if (b.kind === 'hospital' || b.kind === 'shop') {
    px(ctx, dx + 2, H - 24, OUTLINE, 12, 10);
    px(ctx, dx + 3, H - 23, '#ffffff', 10, 8);
    if (b.kind === 'hospital') {
      px(ctx, dx + 7, H - 22, '#3aa457', 2, 6);
      px(ctx, dx + 5, H - 20, '#3aa457', 6, 2);
    } else {
      paint(ctx, ['.yyy.', 'yyoyy', 'yoyyy', 'yyoyy', '.yyy.'], { y: '#f2c230', o: '#b0841a' }, dx + 6, H - 22);
    }
  }

  tex.refresh();
}

// ---------------------------------------------------------------- characters

/*
 * Characters are 16x16 with 3 frames (stand, step A, step B) for 3 directions.
 * Facing right is facing left, flipped. Palette letters:
 *   o outline, h hair, s skin, e eyes, c shirt, d shirt shade, p trousers, b shoes
 * "down" and "up" are symmetric, so only their left halves are written out.
 */
const HALF_DOWN = [
  '........', '.....ooo', '....ohhh', '...ohhhh', '...ohhhh', '...ohsss', '...osses', '...ossss',
  '....ooss', '...occcc', '..socccc', '..sodddd', '...opppp', '...oppo.', '...obbo.', '....oo..',
];
const HALF_UP = [
  '........', '.....ooo', '....ohhh', '...ohhhh', '...ohhhh', '...ohhhh', '...ohhhh', '...ohhhh',
  '....oohh', '...occcc', '..socccc', '..sodddd', '...opppp', '...oppo.', '...obbo.', '....oo..',
];
const mirror = (half) => half.map((row) => row + [...row].reverse().join(''));

const LEGS_A = ['...oppo..oppo...', '...obbo...oo....', '....oo..........'];
const LEGS_B = ['...oppo..oppo...', '....oo...obbo...', '..........oo....'];

const LEFT_BODY = [
  '................', '.....oooooo.....', '....ohhhhhho....', '...ohhhhhhhho...',
  '...ohhhhhhhho...', '...osshhhhhho...', '...oseshhhhho...', '...osssshhhho...',
  '....oosssoo.....', '....occcccco....', '....occsccco....', '....oddsdddo....',
  '....oppppppo....',
];
const LEFT_LEGS_STAND = ['.....oppppo.....', '.....obbbbo.....', '......oooo......'];
const LEFT_LEGS_STEP = ['....oppo.oppo...', '...obbo...obbo..', '....oo.....oo...'];

const down = mirror(HALF_DOWN);
const up = mirror(HALF_UP);
const left = [...LEFT_BODY, ...LEFT_LEGS_STAND];

/** [direction row][frame] -> 16 rows of 16 characters. Exported for tests. */
export const CHARACTER_FRAMES = [
  [down, [...down.slice(0, 13), ...LEGS_A], [...down.slice(0, 13), ...LEGS_B]],
  [up, [...up.slice(0, 13), ...LEGS_A], [...up.slice(0, 13), ...LEGS_B]],
  [left, [...LEFT_BODY, ...LEFT_LEGS_STEP], [...LEFT_BODY, ...LEFT_LEGS_STEP]],
];

const SHIRTS = ['#d94a4a', '#3f7fd9', '#e0a530', '#3fae6a', '#9a5ad9', '#e06aa8', '#2fb3c4', '#e0773a'];
const HAIRS = ['#3a2a20', '#7a4a22', '#e2c25a', '#2b2a33', '#b8452e', '#6b6f7a'];

/** Colors for the bot trainer: silver and grey, like a little robot. */
export const BOT_COLORS = { hair: '#c0c6cf', shirt: '#7d8796', pants: '#4b5260', skin: '#d9dee6' };

/** A stable look for a username, so everyone sees the same colors. @param {string} name */
export function colorsForName(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { hair: HAIRS[h % HAIRS.length], shirt: SHIRTS[(h >>> 3) % SHIRTS.length], pants: '#3b4a6b' };
}

/**
 * Get (creating if needed) a character spritesheet in these colors.
 * @param {Phaser.Scene} scene
 * @param {{hair: string, shirt: string, pants: string, skin?: string}} colors
 * @returns {string} texture key
 */
export function characterTexture(scene, colors) {
  const key = `char-${colors.hair}-${colors.shirt}-${colors.pants}-${colors.skin ?? ''}`;
  if (scene.textures.exists(key)) return key;
  const palette = {
    o: OUTLINE, e: OUTLINE, b: '#3a2a20',
    h: colors.hair, s: colors.skin ?? '#f2c79a', c: colors.shirt, d: shade(colors.shirt), p: colors.pants,
  };
  const tex = scene.textures.createCanvas(key, S * 3, S * 3);
  const ctx = tex.getContext();
  CHARACTER_FRAMES.forEach((frames, row) => {
    frames.forEach((rows, col) => {
      paint(ctx, rows, palette, col * S, row * S);
      tex.add(row * 3 + col, 0, col * S, row * S, S, S);
    });
  });
  tex.refresh();
  return key;
}

/**
 * Frame index and flip for a direction and walk step (0 = stand, 1 / 2 = steps).
 * @param {import('/shared/world.js').Dir} dir
 * @param {number} step
 */
export function characterFrame(dir, step) {
  const row = dir === 'down' ? 0 : dir === 'up' ? 1 : 2;
  return { frame: row * 3 + step, flipX: dir === 'right' };
}

/** Darken a #rrggbb color a little. @param {string} hex */
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.75).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
