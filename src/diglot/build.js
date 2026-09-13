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

const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;

/** Local modules this file imports, by bare filename. */
function dependencies(source) {
  const names = [];
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    if (!match[2].startsWith('.')) continue;       // node builtins, packages
    names.push(basename(match[2]));
  }
  return names;
}

/**
 * Every binding a module pulls in, as { local, source }. Flattening modules
 * into one scope makes plain imports vanish harmlessly — but a renamed one
 * ("article as esArticle") leaves code calling a name nothing declares, and
 * the failure only shows on the code path that uses it.
 */
function importedBindings(source) {
  const bindings = [];
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const [, clause, specifier] = match;
    if (!specifier.startsWith('.')) continue;
    const named = clause.match(/\{([\s\S]*)\}/);
    if (!named) throw new Error(`bundle: only named imports are supported — found "${clause.trim()}"`);
    for (const part of named[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const [origin, local] = piece.split(/\s+as\s+/).map((x) => x.trim());
      bindings.push({ origin, local: local || origin });
    }
  }
  return bindings;
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

// Re-create renamed imports as plain aliases, once, before anything uses them.
const aliases = new Map();
for (const name of order) {
  for (const { origin, local } of importedBindings(sources.get(name))) {
    if (local !== origin) aliases.set(local, origin);
  }
}
const aliasBlock = aliases.size
  ? '// ── renamed imports, preserved as aliases ─────────────────────\n'
    + [...aliases].map(([local, origin]) => `const ${local} = ${origin};`).join('\n')
  : '';

const parts = order.map((name) => {
  const label = where.get(name).replace(root + '/', '');
  const body = `// ── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}\n${strip(sources.get(name))}`;
  // Aliases go in after the module that declares the original, before any user.
  return name === 'app.js' ? body : body;
});

// Insert the aliases after the last module that declares one of the originals.
if (aliasBlock) {
  const originModules = new Set();
  for (const origin of aliases.values()) {
    const owner = order.find((name) => new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:const|let|var|function|class)\\s+${origin}\\b`, 'm').test(sources.get(name)));
    if (!owner) throw new Error(`bundle: nothing declares "${origin}", imported under another name`);
    originModules.add(order.indexOf(owner));
  }
  parts.splice(Math.max(...originModules) + 1, 0, aliasBlock);
}

const html = readFileSync(join(root, 'diglot', 'index.html'), 'utf8');
const marker = '<script type="module" src="./app.js"></script>';
if (!html.includes(marker)) throw new Error('bundle: entry script tag not found in index.html');
const bundled = html.replace(marker, `<script type="module">\n${parts.join('\n\n')}\n</script>`);

// A bundle that silently drops a module renders a blank page, so check here.
const leftovers = bundled.match(/^\s*(import|export)\s/gm);
if (leftovers) throw new Error(`bundle: ${leftovers.length} unresolved import/export statements`);

// Every name any module imported must now be declared somewhere in the output,
// or the code that uses it throws the moment that path runs.
const missing = [];
for (const name of order) {
  for (const { local } of importedBindings(sources.get(name))) {
    const declared = new RegExp(`^(?:async\\s+)?(?:const|let|var|function|class)\\s+${local}\\b`, 'm').test(bundled);
    if (!declared && !missing.includes(local)) missing.push(local);
  }
}
if (missing.length) throw new Error(`bundle: imported but never declared — ${missing.join(', ')}`);

const out = join(root, 'diglot', 'diglot.html');
writeFileSync(out, bundled);
console.log(`${out}  ${(bundled.length / 1024).toFixed(0)} KB`);
console.log(`  ${order.length} modules: ${order.join(' → ')}`);
