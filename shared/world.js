// The one seamless world, generated from a fixed seed.
// Imported by both the server (for validation) and the browser (for drawing),
// so the two always agree on every tile.
//
// To enlarge the world later, change WORLD_W / WORLD_H. The town stays in the
// middle because TOWN is derived from the world size.

import { createRng, randInt } from './rng.js';

export const TILE_SIZE = 16;
export const WORLD_W = 80;
export const WORLD_H = 80;
export const WORLD_SEED = 20261115;

/** Size of the visible window, in tiles. */
export const VIEW_W = 15;
export const VIEW_H = 11;

/** Milliseconds one step takes. The server's speed check is based on this. */
export const STEP_MS = 200;

/** Thickness of the impassable tree border around the world. */
const BORDER = 2;

/** Tile ids. Order matters: the client's tileset uses the same indexes. */
export const T = {
  GROUND: 0, // short town grass, no encounters
  PATH: 1,
  TALL_GRASS: 2, // wild encounters happen here
  TREE: 3,
  WATER: 4,
  DIRT: 5, // bare ground in the wilderness, no encounters
  BUILDING: 6, // covered by a building image
  FLOWERS: 7,
};

const SOLID = new Set([T.TREE, T.WATER, T.BUILDING]);

/** @typedef {'up'|'down'|'left'|'right'} Dir */

/** @type {Record<Dir, {dx: number, dy: number}>} */
export const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** The town: the central 30 x 30 tiles. */
export const TOWN = {
  w: 30,
  h: 30,
  x: Math.floor((WORLD_W - 30) / 2),
  y: Math.floor((WORLD_H - 30) / 2),
};

/** Where new players appear: the middle of the town, on the crossroads. */
export const SPAWN = { x: TOWN.x + 15, y: TOWN.y + 15, dir: /** @type {Dir} */ ('down') };

/**
 * @typedef {object} Building
 * @property {string} id
 * @property {'hospital'|'shop'|'house'} kind
 * @property {number} x top-left tile
 * @property {number} y top-left tile
 * @property {number} w width in tiles
 * @property {number} h height in tiles
 * @property {{x: number, y: number}} door the door tile (part of the building, solid)
 * @property {{x: number, y: number}} front the tile in front of the door, where the player stands
 */

/** @type {Building[]} */
export const BUILDINGS = [
  makeBuilding('hospital', 'hospital', 4, 5, 6, 5),
  makeBuilding('shop', 'shop', 20, 5, 6, 5),
  makeBuilding('house1', 'house', 2, 18, 4, 4),
  makeBuilding('house2', 'house', 8, 18, 4, 4),
  makeBuilding('house3', 'house', 18, 18, 4, 4),
];

/** The bot trainer that stands in town. It blocks its tile like a wall. */
export const BOT_NPC = { name: 'Bot', x: TOWN.x + 24, y: TOWN.y + 19, dir: /** @type {Dir} */ ('down') };

/**
 * @param {string} id
 * @param {Building['kind']} kind
 * @param {number} lx x inside the town
 * @param {number} ly y inside the town
 * @param {number} w
 * @param {number} h
 * @returns {Building}
 */
function makeBuilding(id, kind, lx, ly, w, h) {
  const x = TOWN.x + lx;
  const y = TOWN.y + ly;
  const door = { x: x + Math.floor(w / 2), y: y + h - 1 };
  return { id, kind, x, y, w, h, door, front: { x: door.x, y: door.y + 1 } };
}

/**
 * @typedef {object} World
 * @property {number} w
 * @property {number} h
 * @property {Uint8Array} tiles row-major, index = y * w + x
 */

/** @type {World | null} */
let cached = null;

/** The world, generated once and reused. */
export function getWorld() {
  if (!cached) cached = generateWorld();
  return cached;
}

/**
 * Build the world from WORLD_SEED. Pure: same seed, same world.
 * @returns {World}
 */
export function generateWorld() {
  const w = WORLD_W;
  const h = WORLD_H;
  const tiles = new Uint8Array(w * h).fill(T.TALL_GRASS);
  const rng = createRng(WORLD_SEED);
  const set = (x, y, t) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t;
  };

  // Wilderness features are kept away from the town so its edges stay open.
  const nearTown = (x, y) =>
    x >= TOWN.x - 3 && x < TOWN.x + TOWN.w + 3 && y >= TOWN.y - 3 && y < TOWN.y + TOWN.h + 3;

  /** Paint a rough round blob of one tile type. */
  const blob = (cx, cy, r, t) => {
    const R = Math.ceil(r);
    for (let y = cy - R; y <= cy + R; y++) {
      for (let x = cx - R; x <= cx + R; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r * (0.75 + rng() * 0.4) && !nearTown(x, y)) set(x, y, t);
      }
    }
  };
  const randomSpot = () => ({ x: randInt(rng, BORDER, w - BORDER - 1), y: randInt(rng, BORDER, h - BORDER - 1) });

  const area = (w * h) / (80 * 80); // scale feature counts with world size
  for (let i = 0; i < 30 * area; i++) {
    const p = randomSpot();
    blob(p.x, p.y, 1.5 + rng() * 2.5, T.DIRT);
  }
  for (let i = 0; i < 12 * area; i++) {
    const p = randomSpot();
    blob(p.x, p.y, 2 + rng() * 2.2, T.WATER);
  }
  for (let i = 0; i < 40 * area; i++) {
    const p = randomSpot();
    blob(p.x, p.y, 1 + rng() * 1.8, T.TREE);
  }
  for (let i = 0; i < 110 * area; i++) {
    const p = randomSpot();
    if (!nearTown(p.x, p.y)) set(p.x, p.y, T.TREE);
  }

  // Impassable tree border.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < BORDER || y < BORDER || x >= w - BORDER || y >= h - BORDER) set(x, y, T.TREE);
    }
  }

  // The town: short grass, a crossroads, side paths, buildings, flowers.
  for (let y = 0; y < TOWN.h; y++) {
    for (let x = 0; x < TOWN.w; x++) set(TOWN.x + x, TOWN.y + y, T.GROUND);
  }
  for (let i = 0; i < TOWN.w; i++) {
    set(TOWN.x + i, TOWN.y + 14, T.PATH);
    set(TOWN.x + i, TOWN.y + 15, T.PATH);
    set(TOWN.x + 14, TOWN.y + i, T.PATH);
    set(TOWN.x + 15, TOWN.y + i, T.PATH);
  }
  for (let x = 2; x < 28; x++) set(TOWN.x + x, TOWN.y + 23, T.PATH); // southern street
  for (const b of BUILDINGS) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) set(x, y, T.BUILDING);
    }
    // A short path from each door to the nearest street.
    const streetY = b.front.y < TOWN.y + 14 ? TOWN.y + 14 : TOWN.y + 23;
    const step = streetY > b.front.y ? 1 : -1;
    for (let y = b.front.y; y !== streetY; y += step) set(b.front.x, y, T.PATH);
  }
  for (let i = 0; i < 28; i++) {
    const x = TOWN.x + randInt(rng, 0, TOWN.w - 1);
    const y = TOWN.y + randInt(rng, 0, TOWN.h - 1);
    if (tiles[y * w + x] === T.GROUND && !(x === BOT_NPC.x && y === BOT_NPC.y)) set(x, y, T.FLOWERS);
  }

  // Anything walkable that can't be reached from the town becomes a tree,
  // so there are no sealed-off pockets of grass.
  const reached = new Uint8Array(w * h);
  const queue = [SPAWN.y * w + SPAWN.x];
  reached[queue[0]] = 1;
  while (queue.length) {
    const i = /** @type {number} */ (queue.pop());
    const x = i % w;
    const y = Math.floor(i / w);
    for (const { dx, dy } of Object.values(DIRS)) {
      const nx = x + dx;
      const ny = y + dy;
      const j = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || reached[j] || SOLID.has(tiles[j])) continue;
      reached[j] = 1;
      queue.push(j);
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    if (!reached[i] && !SOLID.has(tiles[i])) tiles[i] = T.TREE;
  }

  return { w, h, tiles };
}

/**
 * Tile id at (x, y). Outside the world counts as tree.
 * @param {World} world
 * @param {number} x
 * @param {number} y
 */
export function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return T.TREE;
  return world.tiles[y * world.w + x];
}

/**
 * Can a player stand on (x, y)? Players never block each other.
 * @param {World} world
 * @param {number} x
 * @param {number} y
 */
export function isWalkable(world, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x === BOT_NPC.x && y === BOT_NPC.y) return false;
  return !SOLID.has(tileAt(world, x, y));
}

/** @param {number} x @param {number} y */
export function isInTown(x, y) {
  return x >= TOWN.x && y >= TOWN.y && x < TOWN.x + TOWN.w && y < TOWN.y + TOWN.h;
}

/**
 * The tile a player at (x, y) facing `dir` is looking at.
 * @param {number} x
 * @param {number} y
 * @param {Dir} dir
 */
export function tileInFront(x, y, dir) {
  const d = DIRS[dir];
  return { x: x + d.dx, y: y + d.dy };
}

/**
 * The building whose door is at (x, y), if any.
 * @param {number} x
 * @param {number} y
 * @returns {Building | undefined}
 */
export function buildingWithDoorAt(x, y) {
  return BUILDINGS.find((b) => b.door.x === x && b.door.y === y);
}

/** @param {unknown} d @returns {d is Dir} */
export function isDir(d) {
  return typeof d === 'string' && Object.hasOwn(DIRS, d);
}
