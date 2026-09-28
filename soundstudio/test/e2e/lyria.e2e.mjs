// End-to-end: the Lyria band, against a local stand-in for the relay that
// streams a test tone in 2-second chunks like the real one (relay/worker.js).
// Checks both devices play the same stream from the same start time, taking a
// seat tells the relay to drop that part, and stop reaches everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { startServers, sleep } from './harness.mjs';

async function fakeRelay(){
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }), log = [];
  let stream = 0, timer = null, sample = 0;
  const all = m => wss.clients.forEach(c => c.send(m));
  const status = state => all(JSON.stringify({ t: 'status', state, stream }));
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ t: 'status', state: 'stopped', stream }));
    ws.on('message', d => {
      const m = JSON.parse(d); log.push(m);
      if(m.t === 'play'){
        clearInterval(timer); stream++; sample = 0; status('starting');
        const chunk = () => {   // 2 s of a 220 Hz tone, 16-bit stereo
          const n = 96000, b = Buffer.alloc(12 + n * 4);
          b.writeDoubleLE(sample, 0); b.writeUInt32LE(stream, 8);
          for(let i = 0; i < n; i++){ const v = Math.round(8000 * Math.sin(2 * Math.PI * 220 * (sample + i) / 48000)); b.writeInt16LE(v, 12 + i * 4); b.writeInt16LE(v, 14 + i * 4); }
          sample += n; all(b);
        };
        setTimeout(() => { status('playing'); chunk(); timer = setInterval(chunk, 2000); }, 500);
      }
      if(m.t === 'stop'){ clearInterval(timer); status('stopped'); }
    });
  });
  await new Promise(r => wss.address() ? r() : wss.once('listening', r));
  return { url: `ws://127.0.0.1:${wss.address().port}`, log, close: () => { clearInterval(timer); wss.clients.forEach(c => c.terminate()); wss.close(); } };
}

test('Lyria band: same stream in step on two devices, seats steer it', { timeout: 120000 }, async () => {
  const relay = await fakeRelay(), h = await startServers();
  try{
    const A = await h.page('Host', { band: 'lyria', relay: relay.url }), B = await h.page('Guest', { band: 'lyria', relay: relay.url });
    await h.join(A, h.base, 'Host');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await A.waitForSelector('#hostControls:not([hidden])');   // the room's creator runs the band
    await A.fill('#prompt', 'Driving indie rock in D, 120 bpm'); await A.click('#genBtn'); await sleep(1000);
    await A.click('#playBtn');
    await A.waitForFunction(() => /Playing: Google Lyria/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
    await B.waitForFunction(() => window.jamLyria.playing(), null, { timeout: 10000 });
    await sleep(3000);
    const peek = p => p.evaluate(() => ({ zero: window.jamStart.zero, playing: window.jamLyria.playing(), status: window.jamLyria.state.status, chords: document.getElementById('chords').children.length, facts: document.getElementById('facts').textContent }));
    const a = await peek(A), b = await peek(B);
    assert.ok(a.playing && b.playing, 'both devices play the stream');
    assert.ok(Math.abs(a.zero - b.zero) < 25, `same start time on both devices (${(a.zero - b.zero).toFixed(1)} ms apart)`);
    assert.equal(a.chords, 0, 'no chord chart for the Lyria band (it plays its own changes)');
    assert.match(a.facts, /Google Lyria band/);
    const play = relay.log.find(m => m.t === 'play');
    assert.equal(play.config.bpm, 120); assert.equal(play.config.scale, 'D_MAJOR_B_MINOR');
    assert.match(play.prompts[0].text, /drums.*bass guitar/);
    // the guest takes the drums: the host tells the relay to mute them
    await B.click('.strip:has-text("Drums") .seat');
    await sleep(1500);
    const upd = relay.log.filter(m => m.t === 'update').pop();
    assert.ok(upd && upd.config.muteDrums === true, 'taking the drums mutes them in the music model');
    assert.doesNotMatch(upd.prompts[0].text, /drums/, 'and drops them from the prompt');
    await A.click('#playBtn'); await sleep(1000);
    assert.ok(relay.log.some(m => m.t === 'stop'), 'stop reaches the relay');
    assert.equal(await B.evaluate(() => window.jamLyria.playing()), false, 'guest stops too');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); relay.close(); }
});
