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

// iOS Safari withholds the Web Speech API inside a sandboxed iframe. Touching
// it unguarded once blanked the whole app: the first call sits in loadDoc, so
// nothing rendered at all.
test('browser APIs that may be missing are never touched directly', () => {
  const app = readFileSync(join(root, 'diglot/app.js'), 'utf8');
  const engine = readFileSync(join(root, 'src/diglot/voice.js'), 'utf8');

  // The app talks to the voice engine; only the engine touches the API, and
  // only behind a guard. iOS Safari withholds it inside a sandboxed iframe.
  assert.deepEqual(app.match(/\bspeechSynthesis\s*\./g) || [], [],
    'app.js should go through the voice engine, not speechSynthesis directly');
  assert.match(engine, /typeof speechSynthesis !== 'undefined'/, 'the engine needs the guard');
  // Each use must sit behind a typeof check, an optional chain, or a try.
  for (const use of engine.match(/^.*\bspeechSynthesis\s*\./gm) || []) {
    assert.match(use, /typeof speechSynthesis !== 'undefined'|\?\.|try\s*\{/,
      `unguarded speech API use: ${use.trim()}`);
  }
  assert.match(app, /catch \(err\)/, 'boot should report a failure rather than render nothing');
});

// "import { article as esArticle }" leaves code calling a name that nothing
// declares once the modules are flattened — and it only throws on the code
// path that uses it, which was above 35% on the dial.
test('renamed imports survive bundling', () => {
  const bundle = readFileSync(join(root, 'diglot/diglot.html'), 'utf8');
  const renames = [];
  for (const name of readdirSync(join(root, 'src/diglot')).concat(['app.js'])) {
    const path = name === 'app.js' ? join(root, 'diglot/app.js') : join(root, 'src/diglot', name);
    if (!name.endsWith('.js') || ['build.js', 'deploy.js'].includes(name)) continue;
    const source = readFileSync(path, 'utf8');
    const re = /^import\s+\{([\s\S]*?)\}\s+from\s+['"]\.[^'"]*['"];?\s*$/gm;
    let match;
    while ((match = re.exec(source)) !== null) {
      for (const part of match[1].split(',')) {
        const [origin, local] = part.trim().split(/\s+as\s+/).map((x) => x.trim());
        if (local && local !== origin) renames.push(local);
      }
    }
  }
  assert.ok(renames.length, 'expected the source to use at least one renamed import');
  for (const local of renames) {
    assert.match(bundle, new RegExp(`\\b(?:const|let|var|function|class)\\s+${local}\\b`),
      `"${local}" is imported under a new name but never declared in the bundle`);
  }
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
