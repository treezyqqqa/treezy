"use strict";

const portrait = document.querySelector("#portrait");
const display = portrait.getContext("2d");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const introLength = 6500;
const glyphs = [".", ":", "-", "~", "+", "=", "*", "/", "|", "1", "0", "8", "#", "%", "@"];
const riseBands = [
  [0, 5050], [0.13, 4970], [0.25, 4650], [0.40, 3500],
  [0.53, 2280], [0.73, 1170], [1, 120]
];

let source;
let scene;
let elapsed = 0;
let previousTime;
let frameId = 0;
const grids = new Map();

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function smooth(from, to, value) {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

function variation(column, row, salt) {
  const hash = Math.imul(column + 1, 0x27d4eb2d) ^ Math.imul(row + 1, 0x165667b1) ^ salt;
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}

function surface(width, height = width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function readPhoto(photo) {
  const canvas = surface(photo.naturalWidth, photo.naturalHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(photo, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function sampleCell(image, column, row, columns, rows) {
  const left = Math.floor(column * image.width / columns);
  const right = Math.floor((column + 1) * image.width / columns);
  const top = Math.floor(row * image.height / rows);
  const bottom = Math.floor((row + 1) * image.height / rows);
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const index = (y * image.width + x) * 4;
      red += image.data[index];
      green += image.data[index + 1];
      blue += image.data[index + 2];
    }
  }
  const area = (right - left) * (bottom - top);
  return [Math.round(red / area), Math.round(green / area), Math.round(blue / area)];
}

function rowDelay(y) {
  for (let i = 1; i < riseBands.length; i++) {
    const [end, endTime] = riseBands[i];
    if (y <= end) {
      const [start, startTime] = riseBands[i - 1];
      return startTime + (endTime - startTime) * (y - start) / (end - start);
    }
  }
  return 0;
}

function hairMotion(x, y, lightness) {
  // The outer silhouette can drift while the face and neck stay registered.
  const left = ((x - 0.377) / 0.033) ** 2 + ((y - 0.222) / 0.093) ** 2;
  const right = ((x - 0.628) / 0.052) ** 2 + ((y - 0.259) / 0.112) ** 2;
  return Math.min(left, right) < 1 && lightness < 118;
}

function buildGrid(columns) {
  if (grids.has(columns)) return grids.get(columns);

  const rows = Math.round(columns * 0.85);
  const colors = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => sampleCell(source, column, row, columns, rows))
  );
  const luminance = colors.map(row =>
    row.map(([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722)
  );
  const cells = [];

  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) / rows;
    const verticalFade = smooth(0, 0.12, y) * (1 - smooth(0.85, 1, y));
    const delay = rowDelay(y);

    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) / columns;
      const horizontalFade = smooth(0.025, 0.23, Math.min(x, 1 - x));
      const lightness = luminance[row][column];
      const across = lightness - luminance[row][Math.max(0, column - 1)];
      const above = lightness - luminance[Math.max(0, row - 1)][column];
      const contrast = Math.max(Math.abs(across), Math.abs(above));
      const opacity = verticalFade * horizontalFade *
        (0.43 + 0.57 * smooth(9, 65, lightness + contrast * 0.7));
      if (opacity < 0.025 || lightness < 5) continue;

      const seed = variation(column, row, 0xa2b78131);
      const detail = Math.sqrt(lightness / 225) * 11.5 + Math.min(1.3, Math.max(0, across, above) / 23);
      const variety = 2.45 - 0.85 * smooth(65, 120, lightness);
      const glyphIndex = Math.min(glyphs.length - 1, Math.floor(detail + seed * variety));
      const start = Math.max(0, delay + (seed - 0.5) * 360);

      cells.push({
        column, row, color: `rgb(${colors[row][column].join(",")})`,
        glyph: glyphs[glyphIndex], opacity,
        start, end: Math.min(introLength, start + 810 + (1 - y) * 490 + seed * 180),
        originX: clamp(0.5 + (x - 0.5) * 0.70 + (seed - 0.5) * 0.13),
        originY: Math.max(y + 0.03, 0.91 + variation(column, row, 0x96bd93a7) * 0.12),
        drift: (seed - 0.5) * 0.044,
        hair: hairMotion(x, y, lightness),
        glint: lightness > 115 && variation(column, row, 0x732bac41) < 0.010
      });
    }
  }

  const grid = { columns, rows, cells };
  grids.set(columns, grid);
  return grid;
}

function rasterize(grid, size) {
  const { columns, rows, cells } = grid;
  const atlas = surface(size);
  const ink = atlas.getContext("2d");
  const fontSize = size / columns * 1.43;
  ink.font = `700 ${fontSize}px "Courier New", monospace`;
  ink.textAlign = "center";
  ink.textBaseline = "middle";

  const sprites = cells.map(cell => {
    const x = Math.round(cell.column * size / columns);
    const y = Math.round(cell.row * size / rows);
    const width = Math.round((cell.column + 1) * size / columns) - x;
    const height = Math.round((cell.row + 1) * size / rows) - y;
    ink.globalAlpha = cell.opacity;
    ink.fillStyle = cell.color;
    ink.fillText(cell.glyph, x + width / 2, y + height / 2 + fontSize * 0.035, width * 0.96);
    return { ...cell, x, y, width, height };
  });

  return { ...grid, size, atlas, sprites };
}

function stamp(context, atlas, cell, x = cell.x, y = cell.y) {
  context.drawImage(atlas, cell.x, cell.y, cell.width, cell.height, x, y, cell.width, cell.height);
}

function prepareEntrance(art) {
  art.waiting = art.sprites.slice().sort((a, b) => a.start - b.start);
  art.next = 0;
  art.rising = [];
  art.settled = surface(art.size);
  art.settledInk = art.settled.getContext("2d");
}

function prepareRestingLayers(art) {
  const { size, atlas, sprites, rows } = art;
  const bodyRow = Math.round(rows * 0.51);
  const headHeight = Math.round(bodyRow * size / rows);
  const head = surface(size, headHeight);
  const hair = surface(size, headHeight);
  const headInk = head.getContext("2d");
  const hairInk = hair.getContext("2d");
  headInk.drawImage(atlas, 0, 0, size, headHeight, 0, 0, size, headHeight);
  for (const cell of sprites) {
    if (cell.hair) {
      stamp(hairInk, atlas, cell);
      headInk.clearRect(cell.x, cell.y, cell.width, cell.height);
    }
  }

  art.head = head;
  art.hair = hair;
  art.bodyRow = bodyRow;
  art.glints = sprites.filter(cell => cell.glint && !cell.hair && cell.row < bodyRow).map(cell => {
    const x = cell.x + cell.width / 2;
    const y = cell.y + cell.height / 2;
    const radius = cell.height * 1.45;
    const glow = display.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, cell.color);
    glow.addColorStop(1, "transparent");
    return { x, y, radius, glow };
  });
  art.waiting = art.rising = art.settled = art.settledInk = null;
}

const motes = Array.from({ length: 23 }, (_, index) => ({
  x: 0.30 + variation(index, 18, 0x7dccc4d2) * 0.40,
  depth: variation(index, 31, 0x08f7801b),
  phase: variation(index, 58, 0xb8427339),
  symbol: glyphs[index % 5]
}));

function drawAtmosphere(size, time) {
  const activity = smooth(0, 1450, time) * (1 - 0.83 * smooth(4200, introLength, time));
  const haze = display.createRadialGradient(size * 0.5, size * 0.79, 0, size * 0.5, size * 0.79, size * 0.21);
  haze.addColorStop(0, "rgba(72,109,103,0.13)");
  haze.addColorStop(1, "rgba(72,109,103,0)");
  display.globalAlpha = activity;
  display.fillStyle = haze;
  display.fillRect(0, size * 0.56, size, size * 0.44);

  display.fillStyle = "#89a8a0";
  display.textAlign = "center";
  display.textBaseline = "middle";
  display.font = `${size * 0.008}px monospace`;
  for (const mote of motes) {
    const t = (mote.phase + time / (2900 + mote.depth * 3200)) % 1;
    const x = mote.x + Math.sin(t * Math.PI * 2 + mote.phase * 6) * 0.024;
    const y = 0.965 - t * (0.06 + mote.depth * 0.18);
    display.globalAlpha = (0.13 + 0.34 * activity) * Math.sin(t * Math.PI) ** 2;
    display.fillText(mote.symbol, x * size, y * size);
  }
  display.globalAlpha = 1;
}

function drawEntrance(art, time) {
  const { atlas, size, waiting, rising, settled, settledInk } = art;
  while (art.next < waiting.length && waiting[art.next].start <= time) {
    rising.push(waiting[art.next++]);
  }

  let active = 0;
  for (const cell of rising) {
    if (time >= cell.end) stamp(settledInk, atlas, cell);
    else rising[active++] = cell;
  }
  rising.length = active;
  display.drawImage(settled, 0, 0);

  for (const cell of rising) {
    const t = (time - cell.start) / (cell.end - cell.start);
    const travel = (1 - t) ** 2.35;
    const x = cell.x + (cell.originX * size - cell.x) * travel +
      Math.sin(t * Math.PI) * cell.drift * size;
    const y = cell.y + (cell.originY * size - cell.y) * travel;
    display.globalAlpha = smooth(0, 0.66, t);
    stamp(display, atlas, cell, x, y);
  }
  display.globalAlpha = 1;
}

function drawResting(art, time) {
  const { size, rows, atlas, head, hair, bodyRow, glints } = art;
  const breath = Math.sin(time * Math.PI * 2 / 6100);
  const hairSway = Math.sin(time * Math.PI * 2 / 8900);
  display.drawImage(head, 0, 0);
  display.drawImage(hair, hairSway * size * 0.0009, hairSway * size * 0.00045);

  // Adjacent strips share a boundary as the shoulders and shirt move.
  const lift = y => breath * size * 0.003 *
    smooth(0.51, 0.73, y / size) * (1 - smooth(0.76, 1, y / size));
  for (let row = bodyRow; row < rows; row += 3) {
    const top = Math.round(row * size / rows);
    const bottom = Math.round(Math.min(row + 3, rows) * size / rows);
    const widthChange = breath * size * 0.003 * smooth(0.51, 0.80, row / rows);
    const upper = top - lift(top);
    const lower = bottom - lift(bottom);
    display.drawImage(atlas, 0, top, size, bottom - top,
      -widthChange / 2, upper, size + widthChange, lower - upper);
  }

  for (const { x, y, radius, glow } of glints) {
    const phase = time / 1150 + x * 0.19 + y * 0.29;
    display.globalAlpha = 0.048 * (0.5 + 0.5 * Math.sin(phase)) ** 2;
    display.fillStyle = glow;
    display.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  display.globalAlpha = 1;
}

function prepareQuote() {
  const line = document.querySelector("#quote-text").textContent;
  const visual = document.querySelector("#quote");
  const characters = [];
  let nextTime = 85;
  let revealed = 0;

  const split = line.indexOf(",") + 1;
  for (const text of [line.slice(0, split), line.slice(split)]) {
    const part = document.createElement("span");
    part.className = "quote-line";
    for (const character of text) {
      const letter = document.createElement("span");
      letter.textContent = character;
      letter.dataset.pending = "";
      part.append(letter);
      characters.push({ letter, time: nextTime });
      nextTime += character === "," ? 65 : 35 + (characters.length * 17) % 29;
    }
    visual.append(part);
  }

  return (time, immediate = false) => {
    if (revealed === characters.length) {
      if (immediate) delete characters.at(-1).letter.dataset.cursor;
      return;
    }
    const before = revealed;
    while (revealed < characters.length && (immediate || time >= characters[revealed].time)) {
      delete characters[revealed++].letter.dataset.pending;
    }
    if (revealed === before) return;
    if (before) delete characters[before - 1].letter.dataset.cursor;
    if (!immediate) {
      visual.style.setProperty("--cursor-delay", `-${time % 900}ms`);
      characters[revealed - 1].letter.dataset.cursor = revealed === characters.length ? "fading" : "typing";
    }
  };
}

const typeQuote = prepareQuote();

function draw(time, still = false) {
  display.clearRect(0, 0, scene.size, scene.size);
  if (still) {
    display.drawImage(scene.atlas, 0, 0);
    typeQuote(0, true);
    return;
  }
  drawAtmosphere(scene.size, time);
  if (time < introLength) {
    drawEntrance(scene, time);
  } else {
    if (!scene.head) prepareRestingLayers(scene);
    drawResting(scene, time - introLength);
    typeQuote(time - introLength);
  }
}

function measure() {
  if (!source) return;
  const width = portrait.getBoundingClientRect().width;
  if (width === 0) return;
  const size = Math.round(Math.min(1800, width * (window.devicePixelRatio || 1)));
  const columns = width < 520 ? 108 : width < 620 ? 150 : 174;
  if (scene?.size === size && scene.columns === columns) return;

  portrait.width = portrait.height = size;
  scene = rasterize(buildGrid(columns), size);
  if (!motion.matches && elapsed < introLength) prepareEntrance(scene);
  draw(elapsed, motion.matches);
}

function tick(timestamp) {
  frameId = 0;
  if (previousTime !== undefined) elapsed += timestamp - previousTime;
  previousTime = timestamp;
  draw(elapsed);
  schedule();
}

function schedule() {
  if (scene && !frameId && !motion.matches && !document.hidden) {
    frameId = requestAnimationFrame(tick);
  }
}

function stop() {
  cancelAnimationFrame(frameId);
  frameId = 0;
  previousTime = undefined;
}

function updateMotion() {
  stop();
  if (motion.matches) {
    elapsed = Math.max(elapsed, introLength);
    if (scene) {
      scene.waiting = scene.rising = scene.settled = scene.settledInk = null;
      draw(elapsed, true);
    }
  }
  schedule();
}

document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("paused", document.hidden);
  if (document.hidden) stop();
  else schedule();
});
if (motion.addEventListener) motion.addEventListener("change", updateMotion);
else motion.addListener(updateMotion);

window.addEventListener("resize", measure, { passive: true });
if ("ResizeObserver" in window) {
  const observer = new ResizeObserver(measure);
  observer.observe(portrait);
}

const photo = new Image();
photo.addEventListener("load", () => {
  source = readPhoto(photo);
  if (motion.matches) elapsed = introLength;
  measure();
  schedule();
}, { once: true });
photo.addEventListener("error", () => {
  typeQuote(0, true);
  console.error("Could not load the portrait source.");
}, { once: true });
photo.src = "./assets/reference.png";
