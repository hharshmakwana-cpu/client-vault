// Bundles src/ into dist/: one self-contained index.html (works when opened
// straight from disk) plus the files needed to install it as an offline app.
// Usage: node build.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'src');
const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });

const read = f => fs.readFileSync(path.join(src, f), 'utf8');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}</style>`);
html = html.replace(/<script src="([\w.]+)"><\/script>/g, (_, f) => `<script>\n${read(f)}</script>`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of ['sw.js', 'manifest.json', 'icon.svg']) fs.copyFileSync(path.join(src, f), path.join(dist, f));
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
