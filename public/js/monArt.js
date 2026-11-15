// Placeholder pixel art for the five Mon species (and the shackle item), drawn in code.
// Each Mon is 32x32, facing right. Shapes are filled first, then an outline is
// added automatically around the silhouette, then details go on top.
// Plain canvas (no Phaser), so the same art works in HTML menus and in Phaser
// (via scene.textures.addCanvas).

const SIZE = 32;
const INK = '#2b2a33';
const WHITE = '#ffffff';

/** Tiny pixel painter on a square grid. */
function createGrid(size = 32) {
  /** @type {(string | null)[]} */
  const cells = new Array(size * size).fill(null);
  const set = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < size && y < size) cells[y * size + x] = c;
  };
  return {
    cells,
    px: set,
    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
    },
    ellipse(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y, c);
        }
      }
    },
    /** Filled polygon; a pixel is in if its centre is inside. */
    poly(points, c) {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) {
        for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          let inside = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i];
            const [xj, yj] = points[j];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) set(x, y, c);
        }
      }
    },
    /** Draw an outline in every empty pixel that touches the silhouette. */
    outline(c) {
      const filled = cells.map((v) => v !== null);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (filled[y * size + x]) continue;
          const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            return nx >= 0 && ny >= 0 && nx < size && ny < size && filled[ny * size + nx];
          });
          if (touches) set(x, y, c);
        }
      }
    },
  };
}

/** @typedef {ReturnType<typeof createGrid>} Grid */

/** @type {Record<string, (g: Grid) => void>} */
const PAINTERS = {
  cat(g) {
    const fur = '#f08a3c', dark = '#c4612a', cream = '#fbe3c0', pink = '#f29bb0';
    g.poly([[3, 8], [6, 7], [9, 22], [6, 23]], fur); // tail
    g.ellipse(14, 22, 9, 6, fur); // body
    g.rect(7, 24, 3, 6, fur); // legs
    g.rect(17, 24, 3, 6, fur);
    g.ellipse(22, 14, 7, 6, fur); // head
    g.poly([[16, 11], [17, 3], [22, 8]], fur); // ears
    g.poly([[23, 8], [27, 3], [28, 11]], fur);
    g.outline(INK);
    g.ellipse(15, 25, 5, 3, cream); // belly
    g.ellipse(25, 17, 3.5, 2.5, cream); // muzzle
    g.rect(7, 29, 3, 1, cream); // paws
    g.rect(17, 29, 3, 1, cream);
    g.px(18, 7, pink); // inner ears
    g.px(26, 7, pink);
    g.rect(4, 8, 2, 2, dark); // tail tip
    for (const x of [10, 13, 16]) g.rect(x, 17, 1, 3, dark); // stripes
    g.rect(21, 9, 1, 2, dark);
    g.rect(24, 12, 2, 3, INK); // eye
    g.px(24, 12, WHITE);
    g.px(28, 16, pink); // nose
    g.rect(25, 19, 2, 1, dark); // mouth
  },
  bird(g) {
    const blue = '#4aa3e8', dark = '#2f74b8', light = '#d8eefc', beak = '#f2c230', leg = '#e8743a';
    g.poly([[1, 13], [10, 18], [10, 23], [2, 25]], dark); // tail
    g.ellipse(14, 19, 8, 7, blue); // body
    g.ellipse(21, 11, 6, 6, blue); // head
    g.poly([[17, 7], [18, 1], [21, 5]], dark); // crest
    g.poly([[20, 5], [23, 0], [24, 6]], dark);
    g.poly([[26, 9], [31, 12], [26, 14]], beak);
    g.rect(12, 26, 1, 3, leg); // legs and feet
    g.rect(17, 26, 1, 3, leg);
    g.rect(11, 29, 3, 1, leg);
    g.rect(16, 29, 3, 1, leg);
    g.outline(INK);
    g.ellipse(16, 21, 5, 4, light); // belly
    g.ellipse(11, 18, 5, 4, dark); // wing
    g.rect(8, 19, 5, 1, blue);
    g.rect(8, 21, 4, 1, blue);
    g.rect(27, 12, 3, 1, '#c99a1f'); // beak line
    g.rect(22, 9, 2, 2, INK); // eye
    g.px(22, 9, WHITE);
  },
  snake(g) {
    const scale = '#8a5ac2', dark = '#5f3a8f', belly = '#f0d470';
    g.ellipse(13, 25, 11, 5, scale); // lower coil
    g.ellipse(13, 20, 8, 4, scale); // upper coil
    g.poly([[15, 19], [19, 8], [25, 9], [21, 21]], scale); // neck
    g.ellipse(24, 9, 6, 4, scale); // head
    g.poly([[0, 27], [4, 24], [5, 29]], scale); // tail tip
    g.outline(INK);
    g.ellipse(14, 27.5, 8, 1.6, belly);
    for (const [x, y] of [[8, 18], [12, 17], [16, 18], [5, 24], [10, 25], [19, 24], [22, 26], [20, 13]]) {
      g.rect(x, y, 2, 1, dark); // diamond pattern
    }
    g.rect(25, 7, 2, 2, '#f6e04a'); // eye with a slit
    g.rect(26, 7, 1, 2, INK);
    g.px(28, 9, dark); // nostril
    g.px(30, 10, '#e04a4a'); // tongue
    g.px(31, 9, '#e04a4a');
    g.px(31, 11, '#e04a4a');
  },
  frog(g) {
    const skin = '#5cbf4a', dark = '#3d8a35', belly = '#f2e27a', pink = '#f29bb0';
    g.ellipse(9, 25, 6, 4.5, skin); // back leg
    g.rect(3, 28, 6, 2, skin); // back foot
    g.ellipse(16, 21, 10, 7, skin); // body
    g.ellipse(18, 13, 3.5, 3.5, skin); // eye bumps
    g.ellipse(25, 13, 3.5, 3.5, skin);
    g.rect(22, 25, 3, 4, skin); // front leg
    g.rect(21, 29, 5, 1, skin);
    g.outline(INK);
    g.ellipse(19, 24, 6, 3.5, belly);
    g.ellipse(11, 18, 2, 1.5, dark); // spots
    g.ellipse(7, 22, 1.5, 1.5, dark);
    g.ellipse(14, 16, 1.2, 1, dark);
    g.ellipse(18, 13, 2, 2, WHITE); // eyes
    g.rect(18, 12, 2, 2, INK);
    g.ellipse(25, 13, 2, 2, WHITE);
    g.rect(25, 12, 2, 2, INK);
    g.rect(19, 19, 7, 1, dark); // mouth
    g.px(24, 20, pink);
  },
  fish(g) {
    const body = '#3fb0b5', dark = '#2a7f86', light = '#c9f1ef', fin = '#f29a3a';
    g.poly([[1, 9], [9, 17], [1, 26]], fin); // tail
    g.ellipse(17, 18, 11, 8, body);
    g.poly([[11, 11], [16, 3], [22, 11]], fin); // top fin
    g.poly([[14, 25], [19, 25], [13, 30]], fin); // bottom fin
    g.outline(INK);
    g.ellipse(18, 22, 8, 3, light); // belly
    g.poly([[14, 17], [20, 19.5], [14, 22]], fin); // side fin
    for (const [x, y] of [[9, 16], [12, 13], [15, 15], [11, 19], [18, 14]]) g.rect(x, y, 2, 1, dark); // scales
    g.rect(21, 13, 1, 6, dark); // gill
    g.ellipse(24.5, 15.5, 2, 2, WHITE); // eye
    g.rect(24, 15, 2, 2, INK);
    g.rect(27, 19, 2, 1, INK); // mouth
  },
};

/** The shackle: a metal cuff with a glowing gem, 16x16. @param {Grid} g */
function paintShackle(g) {
  const metal = '#9aa7b8', light = '#e3eaf2', dark = '#5f6b7c', gem = '#3fd0c9';
  g.ellipse(8, 9.5, 6.5, 6, metal);
  g.ellipse(8, 2.5, 2.5, 2.5, metal); // chain link
  g.ellipse(8, 9.5, 4.2, 3.8, null); // hole in the ring
  g.outline(INK); // also outlines the inside of the hole
  g.px(3, 7, light);
  g.px(4, 6, light);
  g.px(5, 5, light);
  g.rect(10, 14, 3, 1, dark);
  g.rect(13, 11, 1, 3, dark);
  g.rect(7, 5, 2, 2, gem); // gem on top of the ring
}

/** @type {Map<string, HTMLCanvasElement>} */
const cache = new Map();

/** Draw a painter into a cached canvas. */
function cachedCanvas(key, size, paint) {
  let canvas = cache.get(key);
  if (canvas) return canvas;
  const g = createGrid(size);
  paint(g);
  canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  g.cells.forEach((color, i) => {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  });
  cache.set(key, canvas);
  return canvas;
}

/**
 * The 32x32 art for a species, facing right. The canvas is shared: don't draw on it.
 * @param {import('/shared/mons.js').SpeciesId} species
 */
export function monCanvas(species) {
  return cachedCanvas(species, SIZE, PAINTERS[species]);
}

/** The 16x16 shackle. */
export function shackleCanvas() {
  return cachedCanvas('shackle', 16, paintShackle);
}

/** An <img> of a canvas, scaled up with crisp pixels. */
function pixelImage(canvas, alt, size, faceLeft = false) {
  const img = document.createElement('img');
  img.src = canvas.toDataURL();
  img.alt = alt;
  img.width = size;
  img.height = size;
  img.className = 'mon-img';
  img.style.imageRendering = 'pixelated';
  if (faceLeft) img.style.transform = 'scaleX(-1)';
  return img;
}

/**
 * An <img> of a species for HTML menus.
 * @param {import('/shared/mons.js').SpeciesId} species
 * @param {number} [size] displayed size in CSS pixels
 * @param {boolean} [faceLeft]
 */
export function monImage(species, size = 64, faceLeft = false) {
  return pixelImage(monCanvas(species), species, size, faceLeft);
}

/** @param {number} [size] */
export function shackleImage(size = 32) {
  return pixelImage(shackleCanvas(), 'shackle', size);
}
