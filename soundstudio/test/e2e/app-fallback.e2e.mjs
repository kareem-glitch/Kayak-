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

test('desktop app: engine plays but your input never arrives -> browser audio', { timeout: 60000 }, async () => {
  const h = await startServers();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', ws => {
    ws.on('message', d => { const m = JSON.parse(String(d)); if(m.q) ws.send(JSON.stringify({ q: m.q, ok: true, input: 'Mic', inChannels: 1 })); });
    const t = setInterval(() => ws.send(JSON.stringify({ t: 'stats', under: 0, players: {}, peak: 0, inLat: 0, outLat: 6 })), 200);   // output runs, but no input blocks ever come
    ws.on('close', () => clearInterval(t));
  });
  await new Promise(r => wss.on('listening', r));
  try{
    const A = await h.page('Host'); await pretendApp(A, wss.address().port);
    await h.join(A, h.base, 'Host'); await inRoom(A);
    assert.ok(await usingBrowserAudio(A), 'switched to Web Audio');
    assert.match(await A.textContent('body'), /no input from your mic/);
    assert.deepEqual(h.errors, []);
  } finally { wss.close(); await h.close(); }
});

test('desktop app: a working engine stays native', { timeout: 60000 }, async () => {
  const h = await startServers();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', ws => {
    ws.on('message', (d, bin) => { if(bin) return; const m = JSON.parse(String(d)); if(m.q) ws.send(JSON.stringify({ q: m.q, ok: true, input: 'Mic', inChannels: 1 })); });
    const block = Buffer.alloc(16 + 128 * 4); block[0] = 1; block[1] = 1;
    const b = setInterval(() => { block.writeDoubleLE(Date.now(), 8); ws.send(block); }, 3);
    const t = setInterval(() => ws.send(JSON.stringify({ t: 'stats', under: 0, players: {}, peak: 0, inLat: 3, outLat: 6 })), 200);
    ws.on('close', () => { clearInterval(t); clearInterval(b); });
  });
  await new Promise(r => wss.on('listening', r));
  try{
    const A = await h.page('Host'); await pretendApp(A, wss.address().port);
    await h.join(A, h.base, 'Host'); await inRoom(A);
    assert.ok(!await usingBrowserAudio(A), 'still on the app engine');
    assert.doesNotMatch(await A.textContent('body'), /uses browser audio/);
    // the stand-in engine only ever sends digital silence: as if the Mac blocks the mic
    await A.waitForFunction(() => /Nothing is coming in from your mic/.test(document.body.textContent), null, { timeout: 12000 });
    assert.deepEqual(h.errors, []);
  } finally { wss.close(); await h.close(); }
});

test('desktop app: the sound check runs on the app engine, and Join keeps it', { timeout: 60000 }, async () => {
  const h = await startServers();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let starts = 0, monitor = 0, updates = 0;
  wss.on('connection', ws => {
    ws.on('message', (d, bin) => {
      if(bin){ if(d[0] === 3 && String(d.subarray(3, 3 + d[1])) === 'monitor') monitor++; return; }
      const m = JSON.parse(String(d)); if(m.t === 'start') starts++; if(m.t === 'update') updates++;
      if(m.q) ws.send(JSON.stringify({ q: m.q, ok: true, input: 'Mic', inChannels: 2, inputs: [{ id: 'iface', label: 'ZOOM AMS' }], outputs: [{ id: 'iface', label: 'ZOOM AMS' }] }));
    });
    const block = Buffer.alloc(16 + 128 * 4); block[0] = 1; block[1] = 1;
    for(let i = 0; i < 128; i++) block.writeFloatLE(0.2 * Math.sin(i / 4), 16 + i * 4);
    const b = setInterval(() => { block.writeDoubleLE(Date.now(), 8); ws.send(block); }, 3);
    const t = setInterval(() => ws.send(JSON.stringify({ t: 'stats', under: 0, players: {}, peak: 0.2, inLat: 3, outLat: 6, update: '0.6.9' })), 100);
    ws.on('close', () => { clearInterval(t); clearInterval(b); });
  });
  await new Promise(r => wss.on('listening', r));
  try{
    const A = await h.page('Host'); await pretendApp(A, wss.address().port);
    await A.goto(h.base); await A.click('#scStart');
    await A.waitForSelector('#scBody:not([hidden])', { timeout: 15000 });
    assert.ok((await A.textContent('#scIn')).includes('ZOOM AMS'), 'the interface is listed');
    await A.waitForFunction(() => /We hear you/.test(document.getElementById('scMsg').textContent), null, { timeout: 5000 });
    assert.deepEqual(await A.$$eval('#scAmps button', bs => bs.map(b => b.textContent)), ['No amp'], 'the app: no amp models yet');
    // the app downloaded a newer version: offered on the start screen
    await A.waitForFunction(() => /0\.6\.9 is ready/.test(document.getElementById('appNote').textContent), null, { timeout: 5000 });
    await A.click('#updateNow'); await sleep(300);
    assert.equal(updates, 1, 'Restart now asks the app to install it');
    await A.click('#scHear'); await sleep(500);
    assert.ok(monitor > 20, 'your input is played back through the engine');
    await A.fill('#nameInput', 'Host'); await A.click('#joinBtn'); await inRoom(A);
    assert.equal(starts, 1, 'Join reuses the engine the sound check started');
    assert.ok(!await usingBrowserAudio(A), 'still on the app engine');
    const m0 = monitor; await sleep(400); assert.ok(monitor - m0 < 3, 'hearing yourself stops when you join');
    assert.deepEqual(h.errors, []);
  } finally { wss.close(); await h.close(); }
});
