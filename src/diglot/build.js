// Bundle the reader into one self-contained HTML file.
//
//   node src/diglot/build.js  →  diglot/diglot.html
//
// The app is written as plain ES modules so it can be served as-is; this just
// inlines them for the times you want a single file you can email to yourself,
// drop on any host, or open from a USB stick with no server at all.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// Dependency order: each module only uses the ones above it.
const MODULES = ['lexicon.js', 'morph.js', 'weave.js', 'ingest.js', 'epub.js', 'llm.js'];

const strip = (source) => source
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export\s+(const|function|async function|class|let)\b/gm, '$1')
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

const parts = MODULES.map((name) => {
  const source = readFileSync(join(here, name), 'utf8');
  return `// ── src/diglot/${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n${strip(source)}`;
});
parts.push(`// ── diglot/app.js ────────────────────────────────────────────\n${strip(readFileSync(join(root, 'diglot', 'app.js'), 'utf8'))}`);

const html = readFileSync(join(root, 'diglot', 'index.html'), 'utf8');
const bundled = html.replace(
  '<script type="module" src="./app.js"></script>',
  `<script type="module">\n${parts.join('\n\n')}\n</script>`,
);

const out = join(root, 'diglot', 'diglot.html');
writeFileSync(out, bundled);
console.log(`${out}  ${(bundled.length / 1024).toFixed(0)} KB`);
