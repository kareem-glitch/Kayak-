// Publish an auto-update: signs the Mac app tarball and the Windows installer
// with the release key and writes download/latest.json, which every app 0.6.1+
// checks on start (src-tauri/src/update.rs). The key is never in the repo:
// pass it in TAURI_SIGNING_PRIVATE_KEY (it's kept in the Vercel project's
// Development environment variables).
//   node scripts/release-update.mjs 0.6.1 "What's new"
// expects ../download/air.band-<v>-Mac.app.tar.gz and ../download/air.band-<v>-Windows-setup.exe
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, notes = ''] = process.argv.slice(2);
if(!version || !process.env.TAURI_SIGNING_PRIVATE_KEY) { console.error('usage: TAURI_SIGNING_PRIVATE_KEY=… node scripts/release-update.mjs <version> [notes]'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url)), dl = path.resolve(here, '../../download');
const sign = f => {
  execFileSync('npx', ['tauri', 'signer', 'sign', f], { cwd: path.resolve(here, '..'), stdio: 'inherit', env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' } });
  return fs.readFileSync(f + '.sig', 'utf8').trim();
};
const mac = `air.band-${version}-Mac.app.tar.gz`, win = `air.band-${version}-Windows-setup.exe`;
for(const f of [mac, win]) if(!fs.existsSync(path.join(dl, f))) { console.error('missing ' + f); process.exit(1); }
const macSig = sign(path.join(dl, mac)), winSig = sign(path.join(dl, win));
const url = f => `https://air.band/download/${f}`;
const latest = { version, notes, pub_date: new Date().toISOString(), platforms: {
  'darwin-aarch64': { signature: macSig, url: url(mac) },
  'darwin-x86_64': { signature: macSig, url: url(mac) },
  'windows-x86_64': { signature: winSig, url: url(win) },
} };
fs.writeFileSync(path.join(dl, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
for(const f of [mac, win]) fs.unlinkSync(path.join(dl, f + '.sig'));   // the signatures live in latest.json
console.log('wrote download/latest.json for ' + version);
