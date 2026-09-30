// End-to-end: inside the desktop app, if the native audio engine can't be
// reached or never plays, the page switches to browser audio so you still hear
// the jam. The app is faked: window.__SS_NATIVE points at a stand-in engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { startServers, sleep } from './harness.mjs';

const pretendApp = (p, port) => p.addInitScript(port => { window.__SS_NATIVE = { port, token: 'tok', version: '0.5.0' }; }, port);
const inRoom = p => p.waitForFunction(() => !document.getElementById('roomView').hidden, null, { timeout: 20000 });
const usingBrowserAudio = p => p.evaluate(() => !!(window.jamAudioCtx && window.jamAudioCtx()));

test('desktop app: no engine to talk to -> browser audio', { timeout: 60000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host'); await pretendApp(A, 1);   // nothing listens on port 1
    await h.join(A, h.base, 'Host'); await inRoom(A);
    await A.waitForFunction(() => /browser audio/.test(document.body.textContent), null, { timeout: 10000 });
    assert.ok(await usingBrowserAudio(A), 'the page plays through Web Audio');
    await h.drawer(A, 'audio');
    assert.equal(await A.isVisible('#engine'), true, 'the app shows the sound-engine switch');
    await A.click('#testSound'); await sleep(600);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('desktop app: engine starts but never plays -> browser audio', { timeout: 60000 }, async () => {
  const h = await startServers();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', ws => {
    ws.on('message', d => { const m = JSON.parse(String(d)); if(m.q) ws.send(JSON.stringify({ q: m.q, ok: true, input: 'Mic', inChannels: 1 })); });
    const t = setInterval(() => ws.send(JSON.stringify({ t: 'stats', under: 0, players: {}, peak: 0, inLat: 0, outLat: 0 })), 200);   // outLat 0: the output never ran
    ws.on('close', () => clearInterval(t));
  });
  await new Promise(r => wss.on('listening', r));
  try{
    const A = await h.page('Host'); await pretendApp(A, wss.address().port);
    await h.join(A, h.base, 'Host'); await inRoom(A);
    assert.ok(await usingBrowserAudio(A), 'switched to Web Audio');
    assert.match(await A.textContent('body'), /browser audio/);
    assert.deepEqual(h.errors, []);
  } finally { wss.close(); await h.close(); }
});
