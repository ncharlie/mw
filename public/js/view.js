// Screen facts shared by the scenes and menus: pixel density, touch devices,
// fullscreen.

/**
 * The canvas is drawn at device resolution (capped at 2x to keep phones fast)
 * and shown at CSS size, so pixel art and text stay sharp.
 */
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

/** Resolution for Phaser text, so labels stay crisp at the largest zoom. */
export const TEXT_RES = 8;

/** A phone or tablet: no mouse hover, a finger as the main pointer. */
export const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Canvas size in game pixels for the current window. */
export function canvasSize() {
  return { width: Math.round(window.innerWidth * DPR), height: Math.round(window.innerHeight * DPR) };
}

/**
 * On touch devices, go fullscreen and lock to landscape where the browser
 * allows it (Android Chrome does; iPhone Safari doesn't, so players there see a
 * "turn your device" hint instead). Must be called from a tap or click.
 */
export function goFullscreenLandscape() {
  if (!isTouch) return;
  const doc = /** @type {any} */ (document);
  const el = /** @type {any} */ (document.documentElement);
  const lock = () => {
    try {
      /** @type {any} */ (screen.orientation)?.lock?.('landscape')?.catch?.(() => {});
    } catch {
      /* not supported */
    }
  };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    lock();
    return;
  }
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (!request) return;
  try {
    Promise.resolve(request.call(el, { navigationUI: 'hide' })).then(lock, () => {});
  } catch {
    /* refused: keep playing in the browser window */
  }
}
