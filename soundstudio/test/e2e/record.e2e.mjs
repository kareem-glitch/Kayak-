// End-to-end: recording just yourself (WAV), the whole jam (audio) and the jam
// with video, while two players and the band play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('record: just me, everyone, everyone + video', { timeout: 180000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Kareem'), B = await h.page('Wife');
    await h.join(A, h.base, 'Kareem');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Wife');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout:30000 });
    await A.click('#claimBtn'); await A.waitForSelector('#hostControls:not([hidden])');
    await A.fill('#prompt', 'Slow funk in E minor, 96 bpm'); await A.click('#genBtn'); await sleep(1500);
    await A.uncheck('#countIn'); await A.click('#playBtn'); await sleep(2000);

    async function take(what, seconds){
      await A.selectOption('#recWhat', what);
      await A.click('#recBtn'); await sleep(seconds * 1000);
      assert.match(await A.textContent('#recStatus'), /^0:0\d$/, 'timer runs while recording');
      await A.click('#recBtn');
      await A.waitForFunction(() => /recorded/.test(document.getElementById('recStatus').textContent), null, { timeout:20000 });
      return A.evaluate(async () => {
        const dl = document.getElementById('recDownload'), media = document.querySelector('#recMedia video, #recMedia audio');
        const blob = await (await fetch(dl.href)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { name: dl.download, label: dl.textContent, tag: media.tagName, type: blob.type, size: bytes.length,
          wavChannels: bytes[0] === 82 ? new DataView(bytes.buffer).getUint16(22, true) : 0, timing: document.getElementById('recTiming').href.startsWith('blob:') };
      });
    }
    const me = await take('me', 4);
    assert.match(me.name, /\.wav$/); assert.equal(me.tag, 'AUDIO'); assert.ok(me.size > 44 + 3.5 * 48000 * 4, `WAV holds ~4 s (${me.size})`);
    assert.ok(me.timing, 'timing file offered too');
    const all = await take('all', 4);
    assert.match(all.name, /\.(webm|m4a)$/); assert.equal(all.tag, 'AUDIO'); assert.match(all.type, /^audio\//); assert.ok(all.size > 20000, `audio file has content (${all.size})`);
    const vid = await take('video', 5);
    assert.match(vid.name, /\.(webm|mp4)$/); assert.equal(vid.tag, 'VIDEO'); assert.match(vid.label, /Download video/); assert.ok(vid.size > 50000, `video file has content (${vid.size})`);
    const dims = await A.evaluate(async () => { const v = document.querySelector('#recMedia video'); if(!v.videoWidth) await new Promise(r => v.addEventListener('loadedmetadata', r, { once:true })); return [v.videoWidth, v.videoHeight]; });
    assert.deepEqual(dims, [1280, 720], 'video is 1280x720');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
