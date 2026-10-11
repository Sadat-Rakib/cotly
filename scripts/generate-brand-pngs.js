// Regenerates the raster brand assets from the SVG masters whenever the mark
// changes. Run: node scripts/generate-brand-pngs.js
// Uses sharp (a transitive dependency of wrangler) — dev-time only, never
// imported by the app.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'public', 'brand');

const jobs = [
  { svg: 'cotly-avatar.svg', png: 'cotly-avatar-512.png', width: 512 },
  { svg: 'cotly-mark.svg', png: 'cotly-mark-512.png', width: 512 },
  { svg: 'cotly-mark-white.svg', png: 'cotly-mark-white-512.png', width: 512 },
  { svg: 'cotly-logo-white.svg', png: 'cotly-logo-white.png', width: 640 },
];

for (const { svg, png, width } of jobs) {
  await sharp(path.join(root, svg), { density: 384 }).resize({ width }).png().toFile(path.join(root, png));
  console.log('wrote', png);
}
