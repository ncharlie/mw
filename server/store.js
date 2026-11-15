// Persistence: one JSON file, saved shortly after each change.
// Everything else talks to this module only, so it can be swapped for a
// database later without touching the game code.

import fs from 'node:fs';
import path from 'node:path';

const SAVE_DELAY_MS = 500;

/**
 * @typedef {object} PlayerRecord
 * @property {number} x
 * @property {number} y
 * @property {import('../shared/world.js').Dir} dir
 * @property {number} wins
 * @property {number} coins
 * @property {number} shackles
 * @property {import('../shared/mons.js').Mon[]} party up to 5, slot 1 is the lead
 * @property {import('../shared/mons.js').Mon[]} storage
 */

/** @type {{ players: Record<string, PlayerRecord> }} */
let data = { players: {} };
let file = '';
/** @type {NodeJS.Timeout | null} */
let timer = null;

/** @param {string} filePath */
export function load(filePath) {
  file = filePath;
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.players ??= {};
  }
}

/** @param {string} name @returns {PlayerRecord | undefined} */
export function getPlayer(name) {
  return data.players[name];
}

/** @param {string} name @param {PlayerRecord} record */
export function setPlayer(name, record) {
  data.players[name] = record;
  save();
}

/** Ask for a save. Many calls within SAVE_DELAY_MS become one write. */
export function save() {
  if (timer || !file) return;
  timer = setTimeout(flush, SAVE_DELAY_MS);
}

/** Write right now (used on shutdown). */
export function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written save
}
