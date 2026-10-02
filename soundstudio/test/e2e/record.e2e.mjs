// End-to-end: recording just yourself (WAV), the whole jam (audio) and the jam
// with video, while two players and the band play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('record: just me, everyone, everyone + video', { timeout: 180000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Kareem'), B = await h.page('Wife');
    // the screen picker can't be clicked in a test: "this tab" is a moving canvas
    await A.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = async () => { const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d'); let x = 0; setInterval(() => { g.fillStyle = '#0f1011'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#ffcc00'; g.fillRect(x = (x + 9) % 1200, 300, 80, 80); }, 33); window.__screenShared = true; return cv.captureStream(30); }; });
    await h.join(A, h.base, 'Kareem');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Wife');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout:30000 });
    await A.waitForSelector('#hostControls:not([hidden])', { state: 'attached' });   // the room's creator runs the band
    await h.drawer(A, 'band'); await A.fill('#prompt', 'Slow funk in E minor, 96 bpm'); await A.click('#genBtn'); await sleep(1500);
    await A.uncheck('#countIn'); await A.click('#playBtn'); await sleep(2000);

    async function take(what, seconds){
      await h.drawer(A, 'record'); await A.selectOption('#recWhat', what);
      await A.click('#recBtn'); await sleep(seconds * 1000);
      assert.match(await A.textContent('#recStatus'), /^0:0\d$/, 'timer runs while recording');
      await A.click('#recBtn');
      await A.waitForFunction(() => /recorded/.test(document.getElementById('recStatus').textContent), null, { timeout:20000 });
      return A.evaluate(async () => {
        const dl = document.getElementById('recDownload'), media = document.querySelector('#recMedia video, #recMedia audio');
        const blob = await (await fetch(dl.href)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { name: dl.download, label: dl.textContent, tag: media.tagName, type: blob.type, size: bytes.length,
          wavChannels: bytes[0] === 82 ? new DataView(bytes.buffer).getUint16(22, true) : 0, wavSeconds: bytes[0] === 82 ? new DataView(bytes.buffer).getUint32(40, true) / new DataView(bytes.buffer).getUint32(28, true) : 0, timing: document.getElementById('recTiming').href.startsWith('blob:') };
      });
    }
    const me = await take('me', 4);
    const look = await A.evaluate(() => { const s = getComputedStyle(document.getElementById('recDownload')); return [s.color, s.backgroundColor]; });
    assert.notEqual(look[0], look[1], `the download button's label is readable (${look})`);
    assert.match(me.name, /\.wav$/); assert.equal(me.tag, 'AUDIO'); assert.ok(me.wavSeconds > 3.5 && me.wavSeconds < 5.5, `WAV holds ~4 s (${me.wavSeconds})`);
    assert.ok(me.timing, 'timing file offered too');
    const all = await take('all', 4);
    assert.match(all.name, /\.(webm|m4a)$/); assert.equal(all.tag, 'AUDIO'); assert.match(all.type, /^audio\//); assert.ok(all.size > 20000, `audio file has content (${all.size})`);
    // separate tracks: a .zip with a 24-bit WAV each for you, the other player and the band, all about as long as the take
    await h.drawer(A, 'record'); await A.check('#recTracks');
    await take('all', 4);
    const zip = await A.evaluate(async () => {
      const a = document.getElementById('recTracksDl'); if(a.hidden) return null;
      const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer()), dv = new DataView(b.buffer), files = [];
      for(let o = 0; dv.getUint32(o, true) === 0x04034b50; ){
        const size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), name = new TextDecoder().decode(b.slice(o + 30, o + 30 + nl)), d = o + 30 + nl;
        files.push({ name, bits: dv.getUint16(d + 34, true), rate: dv.getUint32(d + 24, true), seconds: dv.getUint32(d + 40, true) / (dv.getUint16(d + 22, true) * 3) / dv.getUint32(d + 24, true) });
        o = d + size;
      }
      return { name: a.download, files };
    });
    assert.ok(zip, 'tracks offered'); assert.match(zip.name, /-tracks\.zip$/);
    assert.deepEqual(zip.files.map(f => f.name).sort(), ['Band.wav', 'Wife.wav', 'You.wav'], `one track each (${zip.files.map(f => f.name)})`);
    zip.files.forEach(f => { assert.equal(f.bits, 24); assert.equal(f.rate, 48000); assert.ok(f.seconds > 3 && f.seconds < 5.5, `${f.name} ~4 s (${f.seconds.toFixed(2)})`); });
    await A.uncheck('#recTracks');
    const vid = await take('video', 5);
    assert.match(vid.name, /\.(webm|mp4)$/); assert.equal(vid.tag, 'VIDEO'); assert.match(vid.label, /Download video/); assert.ok(vid.size > 50000, `video file has content (${vid.size})`);
    const scr = await take('screen', 4);
    assert.equal(scr.tag, 'VIDEO'); assert.ok(scr.size > 50000, `screen recording has content (${scr.size})`);
    assert.ok(await A.evaluate(() => window.__screenShared), 'it asked to share the screen');
    const dims = await A.evaluate(async () => { const v = document.querySelector('#recMedia video'); if(!v.videoWidth) await new Promise(r => v.addEventListener('loadedmetadata', r, { once:true })); return [v.videoWidth, v.videoHeight]; });
    assert.deepEqual(dims, [1280, 720], 'video is 1280x720');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});

// iPhone Safari: no screen sharing, and it won't make more audio contexts than
// the page already has; Jam + video must still give a video, not a WAV.
test('record: video still works when no new audio context can be made (iPhone)', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Kareem');
    await A.addInitScript(() => {
      delete MediaDevices.prototype.getDisplayMedia;
      const Orig = window.AudioContext; let made = 0;
      window.AudioContext = class extends Orig { constructor(...a){ if(++made > 2) throw new Error('too many audio contexts'); super(...a); } };
    });
    await h.join(A, h.base, 'Kareem');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    assert.equal(await A.locator('#recWhat option[value="screen"]').count(), 0, 'no screen option without screen sharing');
    await h.drawer(A, 'record'); await A.selectOption('#recWhat', 'video'); await A.check('#recTracks');
    await A.click('#recBtn'); await sleep(4000); await A.click('#recBtn');
    await A.waitForFunction(() => /recorded/.test(document.getElementById('recStatus').textContent), null, { timeout: 20000 });
    const r = await A.evaluate(async () => { const dl = document.getElementById('recDownload'); const b = await (await fetch(dl.href)).blob(); return { name: dl.download, size: b.size, tag: document.querySelector('#recMedia video, #recMedia audio').tagName, zip: !document.getElementById('recTracksDl').hidden }; });
    assert.match(r.name, /\.(mp4|webm)$/, `a video file (${r.name})`); assert.equal(r.tag, 'VIDEO'); assert.ok(r.size > 30000, `with content (${r.size})`);
    assert.ok(r.zip, 'separate tracks too');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
