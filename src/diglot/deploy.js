// Push the reader to Vercel as a static site.
//
//   VERCEL_API_KEY=… node src/diglot/deploy.js
//
// No CLI, no vercel.json, no build step — it uploads the files straight to the
// deployments API. The single-file bundle goes to the root so the bare domain
// works, and the module version rides along at /diglot/ mirroring the repo.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const token = process.env.VERCEL_API_KEY || process.env.VERCEL_TOKEN;
const project = process.env.VERCEL_PROJECT || 'diglot';

if (!token) {
  console.error('Set VERCEL_API_KEY (or VERCEL_TOKEN) first.');
  process.exit(1);
}

async function api(path, body, method) {
  const res = await fetch('https://api.vercel.com' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json.error || json).slice(0, 500));
  return json;
}

const paths = [
  ['index.html', 'diglot/diglot.html'],   // the bundle answers the bare domain
  ['diglot/index.html', 'diglot/index.html'],
  ['diglot/app.js', 'diglot/app.js'],
  ['diglot/diglot.html', 'diglot/diglot.html'],
  ['diglot/README.md', 'diglot/README.md'],
  ['api/tts.js', 'api/tts.js'],          // the serverless ElevenLabs proxy
  ...globSync('src/diglot/*.js', { cwd: root }).sort().map((p) => [p, p]),
];

const files = paths.map(([dest, src]) => ({
  file: dest,
  data: readFileSync(join(root, src)).toString('base64'),
  encoding: 'base64',
}));

const kb = Math.round(files.reduce((n, f) => n + f.data.length * 0.75, 0) / 1024);
console.log(`uploading ${files.length} files (~${kb} KB) to project "${project}"`);

const deployment = await api('/v13/deployments?forceNew=1', {
  name: project,
  files,
  target: 'production',
  projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
});

process.stdout.write(`deployment ${deployment.id} `);
for (let i = 0; i < 90; i++) {
  const state = await api(`/v13/deployments/${deployment.id}`);
  const ready = state.readyState || state.status;
  if (ready === 'READY') {
    console.log('\nlive:');
    for (const url of [state.url, ...(state.alias || [])]) console.log('  https://' + url);
    console.log('\nAn alias that returns a Vercel login page has Deployment Protection on;');
    console.log('turn it off under Project → Settings → Deployment Protection, or use one that does not.');
    break;
  }
  if (ready === 'ERROR' || ready === 'CANCELED') {
    console.error('\nfailed:', state.errorMessage || ready);
    process.exit(1);
  }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 2000));
}
