// One-shot cleanup: Windows-1252 mojibake (em dash, arrows) and a UTF-8 BOM
// crept into some source files. Rewrites them as proper UTF-8.
import fs from 'node:fs';

const files = process.argv.slice(2);
for (const p of files) {
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(/^\uFEFF/, '');
  s = s
    .replace(/â†‘/g, '↑')
    .replace(/â†“/g, '↓')
    .replace(/â€”/g, '—')
    .replace(/â€"/g, '—')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€\x9D/g, '”');
  if (s !== before) {
    fs.writeFileSync(p, s);
    console.log('fixed', p);
  } else {
    console.log('no change', p);
  }
}
