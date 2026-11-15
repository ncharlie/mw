// Small seeded random number generator shared by the server and the browser.
// The same seed always produces the same sequence, which keeps world
// generation (and later, battles) identical on both sides.

/**
 * Mulberry32: a tiny, fast 32-bit PRNG.
 * @param {number} seed any integer
 * @returns {() => number} function returning floats in [0, 1)
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integer in [min, max] (both inclusive).
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Random element of an array.
 * @template T
 * @param {() => number} rng
 * @param {T[]} list
 * @returns {T}
 */
export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}
