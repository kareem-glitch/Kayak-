// Test harness: serves the app, runs a local PeerJS broker, and opens headless
// Chromium pages with fake camera/mic. No internet needed (fonts are skipped).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerServer } from 'peer';
import { chromium } from 'playwright';
import { after } from 'node:test';

// The PeerJS broker keeps internal timers running after it closes, so end the
// test process once this file's tests have all reported.
after(() => { setTimeout(() => process.exit(), 200).unref(); });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css' };

// internet: the test talks to real services (set E2E_PROXY if they're only reachable through a proxy).
// fakeAudio: a WAV file every page's microphone plays (looped) instead of Chromium's test beep.
export async function startServers({ internet = false, fakeAudio = null } = {}){
  const web = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if(u.pathname === '/api/stems'){   // stand-in for the stems service: the funk stock track's parts
      const d = path.join(ROOT, 'packs/funk-em-96'), meta = JSON.parse(fs.readFileSync(path.join(d, 'pack.json')));
      const stems = Object.fromEntries(Object.keys(meta.stems).map(n => [n, fs.readFileSync(path.join(d, n + '.mp3')).toString('base64')]));
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ stems, seconds: 30 }));
    }
    if(u.pathname.startsWith('/api/')){ res.statusCode = 501; return res.end(); }   // arrangement API off: built-in interpreter
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if(!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const brokerPort = 9000 + Math.floor(Math.random() * 900);
  const broker = await new Promise(r => { const s = PeerServer({ port:brokerPort, path:'/', host:'127.0.0.1' }, srv => r(srv)); });
  const base = `http://127.0.0.1:${web.address().port}/?broker=127.0.0.1:${brokerPort}`;
  const proxy = internet && process.env.E2E_PROXY ? [`--proxy-server=${process.env.E2E_PROXY}`] : ['--no-proxy-server'];
  const browser = await chromium.launch({ args:[...proxy, '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(fakeAudio ? [`--use-file-for-fake-audio-capture=${fakeAudio}`] : [])] });
  const errors = [];
  async function page(name, { band = 'tone', relay = null, game = 'free' } = {}){
    const p = await (await browser.newContext({ permissions:['camera', 'microphone'], viewport:{ width:1400, height:900 }, ignoreHTTPSErrors:internet })).newPage();
    await p.addInitScript(([b, r, g]) => { try{ localStorage.setItem('ss.game', g); if(!localStorage.getItem('ss.look')) localStorage.setItem('ss.look', 'cam'); if(!localStorage.getItem('ss.part')) localStorage.setItem('ss.part', 'none'); localStorage.setItem('ss.band', b); if(b === 'lyria') localStorage.setItem('ss.mode', 'live'); if(r) localStorage.setItem('ss.relay', r); }catch(e){} }, [band, relay, game]);   // the built-in band unless a test asks for Lyria
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    return p;
  }
  // Open a settings drawer: the tab beside the stage (phones: the gear first); Connection is the light in the top bar.
  async function drawer(p, name){
    if(await p.isVisible(`[data-drawer="${name}"]`)) return;
    if(name === 'stats') return p.click('#connDot');
    if(!await p.isVisible(`[data-drawer-tab="${name}"]`)) await p.click('#setBtn');
    if(!await p.isVisible(`[data-drawer="${name}"]`)) await p.click(`[data-drawer-tab="${name}"]`);
  }
  async function join(p, url, name){ await p.goto(url); await p.fill('#nameInput', name); await p.click('#joinBtn'); }
  async function close(){ await browser.close(); for(const s of [web, broker]){ s.closeAllConnections && s.closeAllConnections(); s.close(); } }
  return { base, page, join, drawer, errors, close };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
