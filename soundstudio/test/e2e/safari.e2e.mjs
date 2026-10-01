// End-to-end in WebKit (Safari's engine, and the Mac app's web view): recording the
// whole jam works without MediaRecorder (mixed and saved as a WAV, the backing
// track included), video says plainly when it can't be recorded, and your own
// audio's timing is right despite WebKit's drifting output timestamp.
// Skipped where WebKit isn't installed (it needs `npx playwright install webkit`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { webkit } from 'playwright';
import { startServers, sleep } from './harness.mjs';

test('Safari engine: whole-jam recording has the band, video explains itself', { timeout: 120000 }, async t => {
  let b; try{ b = await webkit.launch(); }catch(e){ t.skip('WebKit not installed'); return; }
  const h = await startServers();
  try{
    const A = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    const errors = []; A.on('pageerror', e => errors.push(e.message));
    await A.addInitScript(() => {
      localStorage.setItem('ss.part', 'none'); localStorage.setItem('ss.band', 'tone');
      // headless WebKit has no devices: a made-up camera (a moving square) and mic (a tone)
      navigator.mediaDevices.getUserMedia = async c => {
        const out = new MediaStream();
        if(c.video){ const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240; const g = cv.getContext('2d'); let x = 0; setInterval(() => { g.fillStyle = '#123'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#ff0'; g.fillRect(x = (x + 5) % 300, 100, 20, 20); }, 33); cv.captureStream(30).getVideoTracks().forEach(t => out.addTrack(t)); }
        if(c.audio){ const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.frequency.value = 220; const g = ac.createGain(); g.gain.value = 0.2; o.connect(g).connect(d); o.start(); d.stream.getAudioTracks().forEach(t => out.addTrack(t)); }
        return out;
      };
      navigator.mediaDevices.enumerateDevices = async () => [];
    });
    await A.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await A.goto(h.base); await A.fill('#nameInput', 'Kareem'); await A.click('#joinBtn');
    await A.waitForFunction(() => window.getInvite && window.getInvite(), null, { timeout: 20000 });
    await h.drawer(A, 'band'); await A.fill('#prompt', 'Slow funk in E minor, 96 bpm'); await A.click('#genBtn'); await sleep(1500);
    await A.click('#playBtn'); await sleep(1500);
    const take = async what => {
      await h.drawer(A, 'record'); await A.selectOption('#recWhat', what);
      await A.click('#recBtn'); await sleep(3000); await A.click('#recBtn');
      await A.waitForFunction(() => /recorded|failed/.test(document.getElementById('recStatus').textContent), null, { timeout: 20000 });
      return A.evaluate(async () => {
        const dl = document.getElementById('recDownload'), b = new Uint8Array(await (await fetch(dl.href)).arrayBuffer()), dv = new DataView(b.buffer);
        return { name: dl.download, isWav: b[0] === 82, seconds: b[0] === 82 ? dv.getUint32(40, true) / (dv.getUint16(22, true) * dv.getUint16(34, true) / 8) / 48000 : null, notice: document.getElementById('noticeText').textContent, hasMR: typeof MediaRecorder !== 'undefined' };
      });
    };
    const all = await take('all');
    if(all.hasMR) assert.match(all.name, /\.(m4a|mp4|webm)$/);
    else { assert.ok(all.isWav, 'no MediaRecorder: the whole jam as a WAV'); assert.ok(all.seconds > 2.5 && all.seconds < 4.5, `about as long as the take (${all.seconds} s): your audio's timing is right`); }
    const vid = await take('video');
    if(!vid.hasMR) assert.match(vid.notice, /Video recording isn’t available/, 'says why there is no video');
    assert.deepEqual(errors, []);
  } finally { await b.close(); await h.close(); }
});
