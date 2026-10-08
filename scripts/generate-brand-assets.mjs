// Regenerates every brand asset from assets/kivotos-logo.svg:  node scripts/generate-brand-assets.mjs
//
// The mark is drawn inside a 512 box. Each slot scales it by a ratio that matches the
// painted coverage of the logo it replaced, so icons keep the weight their layouts were
// designed around; adjust a single RATIO constant below to make the mark bigger or smaller.
import sharp from "sharp";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_LOGO = path.join(ROOT, "assets/kivotos-logo.svg");
const MARK = { x0: 104, y0: 96, x1: 419, y1: 415 }; // logo content bbox inside its 512 box
const MARK_W = MARK.x1 - MARK.x0;
const MARK_CX = (MARK.x0 + MARK.x1) / 2;
const MARK_CY = (MARK.y0 + MARK.y1) / 2;
const PLATE_RX = 0.209; // rounded plate radius / canvas

/** Ink-matched mark ratios: canvas fraction the mark's bounding box occupies. */
const RATIO = {
  favicon: 0.595,
  appIcon: 0.677,
  notification: 0.656,
  androidForeground: 0.384,
  monoMark: 0.651,
  desktopIcon: 0.592,
  desktopDevIcon: 0.44,
};

const sourceSvg = await readFile(SOURCE_LOGO, "utf8");
const planes = [...sourceSvg.matchAll(/<path[^>]*d="([^"]+)"[^>]*fill="([^"]+)"/g)].map((m) => ({
  d: m[1],
  fill: m[2],
}));
if (planes.length !== 3)
  throw new Error(`expected 3 paths in ${SOURCE_LOGO}, found ${planes.length}`);

const svgDoc = (w, h, viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" fill="none">${body}</svg>`;

/** The mark inside a `box`-sized canvas at `ratio`, centred; `color` flattens it to one fill. */
function mark(box, ratio, color) {
  const scale = (ratio * box) / MARK_W;
  const transform = `translate(${box / 2},${box / 2}) scale(${scale.toFixed(4)}) translate(${-MARK_CX},${-MARK_CY})`;
  return `<g transform="${transform}">${planes.map(({ d, fill }) => `<path d="${d}" fill="${color ?? fill}"/>`).join("")}</g>`;
}

const plateDoc = (size, ratio, plate = "black") =>
  svgDoc(
    size,
    size,
    `0 0 ${size} ${size}`,
    `<rect width="${size}" height="${size}" rx="${Math.round(size * PLATE_RX)}" fill="${plate}"/>${mark(size, ratio, "white")}`,
  );
const markDoc = (size, ratio, color) =>
  svgDoc(size, size, `0 0 ${size} ${size}`, mark(size, ratio, color));

const raster = (input, size) =>
  sharp(Buffer.from(input), { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha();
const png = (input, size) => raster(input, size).png({ compressionLevel: 9 }).toBuffer();

const STATE_COLOR = { attention: "#22c55e", running: "#3b82f6" };
const faviconDoc = (status) =>
  svgDoc(
    700,
    700,
    "0 0 700 700",
    `<rect width="700" height="700" rx="156" fill="black"/>${mark(700, RATIO.favicon, "white")}` +
      (status === "none"
        ? ""
        : `<circle cx="570" cy="570" r="130" fill="${STATE_COLOR[status]}"/>`),
  );

/** Windows .ico container holding PNG frames. */
function buildIco(sizes, blobs) {
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(blobs[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += blobs[i].length;
  });
  return Buffer.concat([header, ...blobs]);
}

async function write(relPath, data) {
  const target = path.join(ROOT, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  console.log(`  ${relPath}`);
}

console.log("favicons (plate + white mark, optional state dot)");
for (const scheme of ["light", "dark"]) {
  for (const status of ["none", "running", "attention"]) {
    const svg = faviconDoc(status);
    const suffix = status === "none" ? "" : `-${status}`;
    await write(`packages/app/assets/images/favicon-${scheme}${suffix}.svg`, svg);
    await write(`packages/app/assets/images/favicon-${scheme}${suffix}.png`, await png(svg, 48));
  }
}
await write("packages/app/assets/images/favicon.png", await png(faviconDoc("none"), 48));

console.log("app icons (black plate + white mark)");
await write("packages/app/assets/images/icon.png", await png(plateDoc(1024, RATIO.appIcon), 1024));
await write(
  "packages/app/assets/images/splash-icon.png",
  await png(plateDoc(200, RATIO.appIcon), 200),
);
await write(
  "packages/app/public/apple-touch-icon.png",
  await png(plateDoc(180, RATIO.appIcon), 180),
);
await write("packages/app/public/pwa-icon-192.png", await png(plateDoc(192, RATIO.appIcon), 192));
await write("packages/app/public/pwa-icon-512.png", await png(plateDoc(512, RATIO.appIcon), 512));
await write(
  "fastlane/metadata/android/en-US/images/icon.png",
  await png(plateDoc(512, RATIO.appIcon), 512),
);

console.log("mono marks (transparent background)");
await write(
  "packages/app/assets/images/notification-icon.png",
  await png(markDoc(96, RATIO.notification, "white"), 96),
);
await write(
  "packages/app/assets/images/android-icon-foreground.png",
  await png(markDoc(1024, RATIO.androidForeground, "white"), 1024),
);
await write("packages/app/assets/images/mark-green.svg", markDoc(700, RATIO.monoMark, "#20744A"));
await write("packages/app/assets/images/mark-white.svg", markDoc(700, RATIO.monoMark, "white"));

console.log("desktop icons + icns/ico");
for (const [name, size] of [
  ["32x32.png", 32],
  ["64x64.png", 64],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
]) {
  await write(
    `packages/desktop/assets/${name}`,
    await png(plateDoc(size, RATIO.desktopIcon), size),
  );
}
await write(
  "packages/desktop/assets/icon-dev.png",
  await png(plateDoc(1254, RATIO.desktopDevIcon, "#3399FF"), 1254),
);

const iconset = path.join(ROOT, ".dev/icon.iconset");
await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });
for (const [name, size] of [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
]) {
  await writeFile(path.join(iconset, name), await png(plateDoc(size, RATIO.desktopIcon), size));
}
execFileSync("iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  path.join(ROOT, "packages/desktop/assets/icon.icns"),
]);
await rm(iconset, { recursive: true, force: true });
console.log("  packages/desktop/assets/icon.icns");

const desktopIcoSizes = [16, 32, 48, 64, 128, 256];
const desktopIcoBlobs = [];
for (const size of desktopIcoSizes)
  desktopIcoBlobs.push(await png(plateDoc(size, RATIO.desktopIcon), size));
await write("packages/desktop/assets/icon.ico", buildIco(desktopIcoSizes, desktopIcoBlobs));

console.log("done");
