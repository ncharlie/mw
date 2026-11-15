// Game-wide numbers that are not about a particular species. Tune here.

/** What a new player gets after picking a starter. */
export const STARTER_COINS = 50;
export const STARTER_SHACKLES = 10;

/** Shop price of one shackle, in coins. */
export const SHACKLE_PRICE = 10;
/** Most shackles that can be bought at once. */
export const MAX_BUY = 99;

/** Coins for knocking out a wild Mon. */
export const WILD_WIN_COINS = 5;

/** Chance per step on tall grass (outside town) to meet a wild Mon. */
export const ENCOUNTER_CHANCE = 0.1;

/** Time between wild battle rounds. */
export const WILD_ROUND_MS = 800;

/**
 * Capture chance for a wild Mon: (100 - remaining HP percent)%.
 * Full HP = 0, a quarter HP left = 0.75.
 * @param {{hp: number, maxHp: number}} wild
 * @returns {number} 0..1
 */
export function captureChance(wild) {
  return Math.max(0, Math.min(1, 1 - wild.hp / wild.maxHp));
}

/** How long a challenged player has to accept or decline. */
export const CHALLENGE_SECONDS = 20;

/** How long both players have to pick and order their Mons before a match. */
export const ORDER_SECONDS = 30;

/** PvP and bot matches are always this many pairs; players need this many Mons in their party. */
export const PVP_TEAM_SIZE = 3;

/**
 * Most turns shown per pair in a match replay. A longer fight has its rounds
 * grouped into this many turns, each Mon's damage in a group summed into one
 * attack, so every pair plays in under 5 seconds. The result is unchanged.
 */
export const PVP_MAX_TURNS = 3;
