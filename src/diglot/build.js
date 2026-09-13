// Bundle the reader into one self-contained HTML file.
//
//   node src/diglot/build.js  →  diglot/diglot.html
//
// The app is written as plain ES modules so it can be served as-is; this
// inlines them for the times you want a single file you can email to yourself,
// drop on any host, or open from a USB stick with no server at all.
//
// The module order is worked out from the imports rather than listed by hand.
// A hand-written list goes stale the moment someone adds a file, and the
// failure is silent until the page is open in front of you.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const ENTRY = 'app.js';

const sources = new Map();   // name → source text
const where = new Map();     // name → path on disk

function locate(name) {
  for (const candidate of [join(root, 'diglot', name), join(here, name)]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`bundle: cannot find module "${name}"`);
}

function load(name) {
  if (sources.has(name)) return sources.get(name);
  const path = locate(name);
  const source = readFileSync(path, 'utf8');
  sources.set(name, source);
  where.set(name, path);
  return source;
}

/** Local modules this file imports, by bare filename. */
function dependencies(source) {
  const names = [];
  const re = /^import\s[\s\S]*?from\s+['"]([^'"]+)['"];?\s*$/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;      // node builtins, packages
    names.push(basename(specifier));
  }
  return names;
}

// Depth-first, so a module is always emitted after everything it uses.
const order = [];
const state = new Map();     // name → 'visiting' | 'done'
function visit(name, trail = []) {
  if (state.get(name) === 'done') return;
  if (state.get(name) === 'visiting') {
    throw new Error(`bundle: import cycle — ${[...trail, name].join(' → ')}`);
  }
  state.set(name, 'visiting');
  for (const dep of dependencies(load(name))) visit(dep, [...trail, name]);
  state.set(name, 'done');
  order.push(name);
}
visit(ENTRY);

const strip = (source) => source
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export\s+(const|function|async function|class|let)\b/gm, '$1')
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

// Flattening modules into one scope means two files cannot both declare the
// same top-level name. Catch that here, by name, rather than as a blank page.
const declared = new Map();
const clashes = [];
for (const name of order) {
  const seen = new Set();
  const re = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let match;
  while ((match = re.exec(sources.get(name))) !== null) {
    const symbol = match[1];
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    if (declared.has(symbol)) clashes.push(`${symbol} (${declared.get(symbol)} and ${name})`);
    else declared.set(symbol, name);
  }
}
if (clashes.length) {
  throw new Error(`bundle: two modules declare the same top-level name:\n  ${clashes.join('\n  ')}`);
}

const parts = order.map((name) => {
  const label = where.get(name).replace(root + '/', '');
  return `// ── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}\n${strip(sources.get(name))}`;
});

const html = readFileSync(join(root, 'diglot', 'index.html'), 'utf8');
const marker = '<script type="module" src="./app.js"></script>';
if (!html.includes(marker)) throw new Error('bundle: entry script tag not found in index.html');
const bundled = html.replace(marker, `<script type="module">\n${parts.join('\n\n')}\n</script>`);

// A bundle that silently drops a module renders a blank page, so check here.
const leftovers = bundled.match(/^\s*(import|export)\s/gm);
if (leftovers) throw new Error(`bundle: ${leftovers.length} unresolved import/export statements`);

const out = join(root, 'diglot', 'diglot.html');
writeFileSync(out, bundled);
console.log(`${out}  ${(bundled.length / 1024).toFixed(0)} KB`);
console.log(`  ${order.length} modules: ${order.join(' → ')}`);
