// Uploads worker.js as the "soundstudio-band" Worker with its Durable Object
// and the Gemini key as a secret, and enables its workers.dev address.
import { readFileSync } from 'node:fs';
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, GEMINI_API_KEY: key } = process.env;
if(!token || !account || !key) throw new Error('Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and GEMINI_API_KEY');
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/soundstudio-band`;
const auth = { Authorization: `Bearer ${token}` };
const check = async (what, r) => { const d = await r.json(); if(!d.success) throw new Error(what + ': ' + JSON.stringify(d.errors)); console.log(what, 'ok'); return d; };

const existing = await (await fetch(api + '/settings', { headers: auth })).json();
const hasClass = existing.success && (existing.result.bindings || []).some(b => b.type === 'durable_object_namespace');
const metadata = {
  main_module: 'worker.js', compatibility_date: '2026-09-01',
  bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'BandRoom' }, { type: 'secret_text', name: 'GEMINI_API_KEY', text: key }],
  ...(hasClass ? {} : { migrations: { new_tag: 'v1', new_sqlite_classes: ['BandRoom'] } }),
};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.append('worker.js', new Blob([readFileSync(new URL('./worker.js', import.meta.url))], { type: 'application/javascript+module' }), 'worker.js');
await check('upload', await fetch(api, { method: 'PUT', headers: auth, body: form }));
await check('workers.dev', await fetch(api + '/subdomain', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) }));
