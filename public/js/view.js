// Screen facts shared by the scenes and menus: pixel density, touch devices,
// fullscreen.

/**
 * The canvas is drawn at device resolution (capped at 2x to keep phones fast)
 * and shown at CSS size, so pixel art and text stay sharp.
 */
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

/** Resolution for Phaser text, so labels stay crisp at the largest zoom. */
export const TEXT_RES = 8;

/**
 * Does this device have a touch screen? Browsers report this in different ways
 * (and some phones claim a fine pointer), so any sign of touch counts. The
 * first real finger touch also switches touch mode on (see controls.js).
 */
export const hasTouch =
  window.matchMedia('(pointer: coarse)').matches ||
  window.matchMedia('(any-pointer: coarse)').matches ||
  navigator.maxTouchPoints > 0 ||
  'ontouchstart' in window;

/** Canvas size in game pixels for the current window. */
export function canvasSize() {
  return { width: Math.round(window.innerWidth * DPR), height: Math.round(window.innerHeight * DPR) };
}

// ---------------------------------------------------------------- fullscreen

const doc = /** @type {any} */ (document);
const root = /** @type {any} */ (document.documentElement);

/** Can this browser put the page in fullscreen? (iPhone Safari can't.) */
export function fullscreenSupported() {
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen() {
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/**
 * Like a video player's fullscreen button: enter fullscreen and turn to
 * landscape (where the browser allows locking it), or go back. Call from a tap.
 */
export function toggleFullscreen() {
  const orientation = /** @type {any} */ (screen.orientation);
  if (isFullscreen()) {
    try {
      orientation?.unlock?.();
    } catch {
      /* not supported */
    }
    (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)?.catch?.(() => {});
    return;
  }
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (!request) return;
  try {
    Promise.resolve(request.call(root, { navigationUI: 'hide' }))
      .then(() => orientation?.lock?.('landscape'))
      .catch(() => {}); // refused, or the device won't lock: stay as we are
  } catch {
    /* refused */
  }
}
