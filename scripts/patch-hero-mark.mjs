// One-shot patch: replaces the outdated solid "C" inside the hero artwork with
// the current mark (open C ring + dot exiting the gap), preserving the
// illustration everywhere else. Reads hero-device-src.webp (the untouched
// original), writes hero-device.webp (served by the landing page). Dev-time only.
// Re-run after any change: node scripts/patch-hero-mark.mjs
import sharp from 'sharp';

const SRC = 'src/ui/public/brand/hero-device-src.webp';
const OUT = 'src/ui/public/brand/hero-device.webp';

// Old C bounding area plus AA edge. The "Cotly" wordmark starts at x=315, so
// the erase stops at 310 and the right border samples the clean 7px gap.
const X0 = 252, Y0 = 88, X1 = 310, Y1 = 156; // region to erase
const W = X1 - X0, H = Y1 - Y0;

const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const px = (x, y, k) => data[(y * info.width + x) * ch + k];
const avgCol = (x0, x1, y) => {
  const out = [0, 0, 0];
  for (let x = x0; x <= x1; x++) for (let k = 0; k < 3; k++) out[k] += px(x, y, k);
  const n = x1 - x0 + 1;
  return out.map((v) => Math.round(v / n));
};

// Per-row horizontal interpolation between the clean left and right borders.
for (let y = Y0; y < Y1; y++) {
  const left = avgCol(X0 - 5, X0 - 1, y);
  const right = avgCol(X1 + 1, X1 + 3, y);
  for (let x = X0; x < X1; x++) {
    const t = (x - X0) / (W - 1);
    for (let k = 0; k < 3; k++) {
      data[(y * info.width + x) * ch + k] = Math.round(left[k] * (1 - t) + right[k] * t);
    }
  }
}

// Soften the patched region so any banding disappears.
const patched = await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
  .extract({ left: X0 - 4, top: Y0 - 4, width: W + 8, height: H + 8 })
  .blur(1.2)
  .toBuffer();
const base = await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
  .composite([{ input: patched, left: X0 - 4, top: Y0 - 4, raw: { width: W + 8, height: H + 8, channels: ch } }])
  .png().toBuffer();

// New mark in a 64x64 box (1 unit = 1 artwork px): ring r=17.5 stroke 5.2 with
// the gap at 3 o'clock, dot exiting at the right. Ring center lands on the old
// C's center (288.5, 120); violet gradient matches the artwork's palette.
const markSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8b5cc6"/><stop offset="1" stop-color="#5b50d8"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="16.5" stroke="url(#g)" stroke-width="5.4" stroke-linecap="round"
          stroke-dasharray="82.9 20.7" transform="rotate(36 32 32)"/>
  <circle cx="51.5" cy="32" r="4.2" fill="#5b50d8"/>
</svg>`);

await sharp(base)
  .composite([{ input: markSvg, left: Math.round(282.5 - 32), top: Math.round(120 - 32) }])
  .webp({ quality: 92 })
  .toFile(OUT);

console.log('patched ->', OUT);
