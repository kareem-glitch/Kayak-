// Builds the desktop app's page: the website's files, with the audio module
// swapped for the native one. Output: desktop/dist (git-ignored).
import { cpSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), desktop = join(here, '..'), site = join(desktop, '..'), dist = join(desktop, 'dist');
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist);
for(const p of ['index.html', 'app', 'vendor', 'audio']) cpSync(join(site, p), join(dist, p), { recursive: true });
copyFileSync(join(desktop, 'web', 'native-io.js'), join(dist, 'app', 'audio', 'io.js'));
rmSync(join(dist, 'app', 'audio', 'worklet.js'), { force: true });
console.log('desktop page built in', dist);
