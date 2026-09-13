import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The single-file build once shipped a blank page for days: a hand-written
// module list went stale when new modules were added, and nothing caught it
// because the modular version — the one served in development — was fine.
test('the single-file bundle contains every module and resolves cleanly', () => {
  execFileSync('node', [join(root, 'src/diglot/build.js')], { cwd: root, encoding: 'utf8' });
  const bundle = readFileSync(join(root, 'diglot/diglot.html'), 'utf8');

  const modules = readdirSync(join(root, 'src/diglot'))
    .filter((f) => f.endsWith('.js') && !['build.js', 'deploy.js'].includes(f));
  assert.ok(modules.length >= 10, `only found ${modules.length} modules`);
  for (const name of modules) {
    assert.ok(bundle.includes(`src/diglot/${name}`), `${name} is missing from the bundle`);
  }
  assert.ok(bundle.includes('diglot/app.js'), 'the app itself is missing');

  // Nothing may survive that a browser would refuse to run in one script.
  assert.equal(bundle.match(/^\s*import\s/gm), null, 'unresolved import in the bundle');
  assert.equal(bundle.match(/^\s*export\s/gm), null, 'unresolved export in the bundle');
});

test('no two modules declare the same top-level name', () => {
  // Flattened into one scope, a duplicate declaration kills the whole script.
  const declared = new Map();
  const clashes = [];
  for (const name of readdirSync(join(root, 'src/diglot')).filter((f) => f.endsWith('.js'))) {
    if (['build.js', 'deploy.js'].includes(name)) continue;
    const source = readFileSync(join(root, 'src/diglot', name), 'utf8');
    const re = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
    const seen = new Set();
    let match;
    while ((match = re.exec(source)) !== null) {
      const symbol = match[1];
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      if (declared.has(symbol)) clashes.push(`${symbol}: ${declared.get(symbol)} and ${name}`);
      else declared.set(symbol, name);
    }
  }
  assert.deepEqual(clashes, []);
});
