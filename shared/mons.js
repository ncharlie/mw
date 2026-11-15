// Mon species and individual Mons. Tune the numbers here.
// Shared by the server (spawning, battles) and the browser (menus, art).

/** @typedef {'cat'|'bird'|'snake'|'frog'|'fish'} SpeciesId */

/**
 * @typedef {object} Species
 * @property {SpeciesId} id
 * @property {string} name
 * @property {number} hp
 * @property {number} atk
 * @property {number} def
 * @property {number} spd
 * @property {SpeciesId} strongAgainst
 */

/** @type {Record<SpeciesId, Species>} */
export const SPECIES = {
  cat: { id: 'cat', name: 'Cat', hp: 90, atk: 14, def: 8, spd: 12, strongAgainst: 'bird' },
  bird: { id: 'bird', name: 'Bird', hp: 70, atk: 16, def: 5, spd: 15, strongAgainst: 'snake' },
  snake: { id: 'snake', name: 'Snake', hp: 80, atk: 13, def: 7, spd: 11, strongAgainst: 'frog' },
  frog: { id: 'frog', name: 'Frog', hp: 100, atk: 12, def: 9, spd: 9, strongAgainst: 'fish' },
  fish: { id: 'fish', name: 'Fish', hp: 120, atk: 10, def: 12, spd: 6, strongAgainst: 'cat' },
};

/** @type {SpeciesId[]} */
export const SPECIES_IDS = ['cat', 'bird', 'snake', 'frog', 'fish'];

/** Damage multiplier when attacking a species you are strong against. */
export const ADVANTAGE_MULTIPLIER = 1.5;

/** Each stat of a new Mon is the species value +/- up to this fraction. */
export const STAT_SPREAD = 0.1;

/** Most Mons a player can carry; the rest go to storage. */
export const PARTY_SIZE = 5;

/**
 * An individual Mon. Stats are rolled once when it spawns and never change.
 * @typedef {object} Mon
 * @property {string} id unique id (empty for throwaway Mons, e.g. in tests)
 * @property {SpeciesId} species
 * @property {number} maxHp
 * @property {number} hp current HP, 0..maxHp
 * @property {number} atk
 * @property {number} def
 * @property {number} spd
 */

/** @param {unknown} s @returns {s is SpeciesId} */
export function isSpecies(s) {
  return typeof s === 'string' && Object.hasOwn(SPECIES, s);
}

/**
 * 1.5 if the attacker's species is strong against the defender's, else 1.
 * @param {SpeciesId} attacker
 * @param {SpeciesId} defender
 */
export function advantageMultiplier(attacker, defender) {
  return SPECIES[attacker].strongAgainst === defender ? ADVANTAGE_MULTIPLIER : 1;
}

/**
 * Spawn a new Mon with every stat rolled +/-10% around its species values.
 * @param {SpeciesId} species
 * @param {() => number} rng
 * @param {string} [id]
 * @returns {Mon}
 */
export function rollMon(species, rng, id = '') {
  const base = SPECIES[species];
  const roll = (/** @type {number} */ value) =>
    Math.max(1, Math.round(value * (1 - STAT_SPREAD + rng() * 2 * STAT_SPREAD)));
  const maxHp = roll(base.hp);
  return { id, species, maxHp, hp: maxHp, atk: roll(base.atk), def: roll(base.def), spd: roll(base.spd) };
}

/**
 * A random species, each equally likely.
 * @param {() => number} rng
 * @returns {SpeciesId}
 */
export function randomSpecies(rng) {
  return SPECIES_IDS[Math.floor(rng() * SPECIES_IDS.length)];
}
