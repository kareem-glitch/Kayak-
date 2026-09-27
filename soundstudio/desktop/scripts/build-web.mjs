// The app's window loads the live website (see src-tauri/src/main.rs), so the
// bundled page is only a fallback shown if the site can't be reached.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist);
writeFileSync(new URL('index.html', dist), `<!doctype html><meta charset="utf-8"><title>SoundStudio</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#121c1f;color:#e6eee8;font:16px system-ui,sans-serif;text-align:center">
<div><h1 style="margin:0 0 8px">SoundStudio</h1><p>Couldn’t reach SoundStudio. Check your internet connection and reopen the app.</p></div>`);
console.log('fallback page written');
