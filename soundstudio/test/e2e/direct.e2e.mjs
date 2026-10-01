// End-to-end: two desktop apps (0.6.0+) in a room switch to direct app-to-app
// audio. The apps' engines are stand-ins joined by a pretend network: each makes
// a steady tone as "your input", and once the pages have swapped addresses and
// tokens, carries it straight to the other engine, as direct.rs does. Checks the
// pages set it up, stop sending the WebRTC copy, don't play it twice in a free
// jam, and show the path as app to app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { startServers, sleep } from './harness.mjs';

const tokens = new Map();   // token -> engine (the pretend network)
function engine(name){
  const e = { name, token: String(1000 + tokens.size), peers: new Map(), up: new Set(), delivered: new Map(), play: null, clk: 0, ws: null, seq: 0 };
  tokens.set(e.token, e);
  e.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  e.wss.on('connection', ws => {
    e.ws = ws;
    ws.on('message', (d, bin) => {
      if(bin){ const b = Buffer.from(d); if(b[0] === 3){ const id = b.slice(3, 3 + b[1]).toString(); e.delivered.set(id, (e.delivered.get(id) || 0) + 1); } return; }
      const m = JSON.parse(String(d)), reply = r => ws.send(JSON.stringify(Object.assign({ q: m.q, ok: true }, r)));
      if(m.t === 'start') reply({ input: 'Mic', inChannels: 1, output: 'Out' });
      else if(m.t === 'devices') reply({ inputs: [], outputs: [] });
      else if(m.t === 'directInfo') reply({ token: e.token, addrs: ['127.0.0.1:1'] });
      else if(m.t === 'directPeer'){ e.peers.set(m.id, m.token); setTimeout(() => { e.up.add(m.id); ws.send(JSON.stringify({ t: 'direct', id: m.id, send: true, recv: true })); }, 300); }
      else if(m.t === 'directPlay') e.play = m.on;
      else if(m.t === 'clk') e.clk = m.off;
      else if(m.q) reply({});
    });
    // your input: a block of tone every 2.67 ms, and stats saying the output runs
    let ph = 0;
    const tick = setInterval(() => {
      const now = Date.now(), b = Buffer.alloc(16 + 128 * 4); b[0] = 1; b[1] = 1; b.writeDoubleLE(now, 8);
      for(let i = 0; i < 128; i++) b.writeFloatLE(0.3 * Math.sin(ph += 0.06), 16 + i * 4);
      if(ws.readyState === 1) ws.send(b);
      // ... and straight to every app it has a direct path to (as direct.rs would)
      for(const [id, tok] of e.peers){
        const other = tokens.get(tok); if(!e.up.has(id) || !other || !other.ws) continue;
        const myIdThere = [...other.peers].find(([, t]) => t === e.token); if(!myIdThere) continue;
        const idb = Buffer.from(myIdThere[0]), o = (24 + idb.length + 3) & ~3, r = Buffer.alloc(o + 128 * 4);
        r[0] = 4; r[1] = idb.length; r[2] = 1; r[3] = 16; r.writeUInt32LE(e.seq++, 4); r.writeDoubleLE(now + e.clk, 8); r.writeDoubleLE(Date.now(), 16); idb.copy(r, 24);
        b.copy(r, o, 16);
        if(other.ws.readyState === 1) other.ws.send(r);
      }
    }, 2.67);
    const stats = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'stats', under: 0, players: {}, peak: 0.3, inLat: 3, outLat: 6 })), 200);
    ws.on('close', () => { clearInterval(tick); clearInterval(stats); });
  });
  return new Promise(r => e.wss.on('listening', () => r(e)));
}

test('two desktop apps: audio goes app to app', { timeout: 90000 }, async () => {
  const h = await startServers();
  const ea = await engine('A'), eb = await engine('B');
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    for(const [p, e] of [[A, ea], [B, eb]]) await p.addInitScript(port => { window.__SS_NATIVE = { port, token: 'tok', version: '0.6.0' }; }, e.wss.address().port);
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await B.goto(h.base); await B.fill('#inviteInput', await A.evaluate(() => window.getInvite())); await B.fill('#nameInput', 'Guest'); await B.click('#joinBtn');   // in the app you paste the invite
    // the direct path comes up and audio flows on it
    await B.waitForFunction(() => { const p = [...window.jamPeers.values()][0]; return p && p.directAt && performance.timeOrigin + performance.now() - p.directAt < 300; }, null, { timeout: 15000 });
    await A.waitForFunction(() => { const p = [...window.jamPeers.values()][0]; return p && p.directSend; }, null, { timeout: 5000 });
    await sleep(1500);
    // the WebRTC copy stopped: Host's page isn't handing Guest's audio to its engine (the engine plays it) ...
    const before = ea.delivered.get([...ea.peers.keys()][0]) || 0; await sleep(1000);
    const after = ea.delivered.get([...ea.peers.keys()][0]) || 0;
    assert.ok(after - before < 5, `free jam: the engine plays app-to-app audio, the page doesn't play it again (${after - before} blocks in 1 s)`);
    assert.equal(ea.play, null, 'free jam: direct play stays on (never switched off)');
    // ... and the path is shown
    await h.drawer(B, 'stats');
    await B.waitForFunction(() => /app to app/.test(document.getElementById('latList').textContent), null, { timeout: 5000 });
    assert.match(await B.textContent('#latList'), /packet 2\.7|packet 1\.3/);
    const level = await B.evaluate(() => window.jamLevel && window.jamLevel([...window.jamPeers.keys()][0]));
    assert.deepEqual(h.errors, []);
    void level;
  } finally { ea.wss.close(); eb.wss.close(); await h.close(); }
});
