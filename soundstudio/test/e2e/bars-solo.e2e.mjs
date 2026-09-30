// End-to-end: BARS on your own. Pick BARS 4 on the start screen, start a room
// (you run the band straight away), take the guitar seat, press play: you
// trade 4s with the AI band. On your turn the AI guitar drops out; on the
// band's turn it covers for you and the AI soloist answers what you played.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServers, sleep } from './harness.mjs';

// What "you" play into the microphone: a little E minor pentatonic phrase in
// eighth notes, guitar-like (harmonics, each note fading), looped by Chromium.
function melodyWav(){
  const rate = 48000, notes = [64, 67, 69, 71, 74, 71, 69, 67], eighth = 0.3125, n = Math.round(rate * eighth * notes.length);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for(let i = 0; i < n; i++){
    const k = Math.floor(i / (rate * eighth)), t = i / rate - k * eighth, hz = 440 * Math.pow(2, (notes[k] - 69) / 12);
    const v = Math.exp(-t * 5) * (0.5 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t) + 0.1 * Math.sin(6 * Math.PI * hz * t));
    b.writeInt16LE(Math.round(v * 0.6 * 32767), 44 + i * 2);
  }
  const f = path.join(os.tmpdir(), 'airband-melody.wav'); fs.writeFileSync(f, b); return f;
}

test('BARS solo: you trade with the AI band; your seat drops out only on your turn', { timeout: 120000 }, async () => {
  const h = await startServers({ fakeAudio: melodyWav() });
  try{
    const A = await h.page('Solo', { band: 'stems', game: 'free' });
    await A.goto(h.base);
    await A.click('[data-pick="4"]');
    assert.match(await A.textContent('#pickNote'), /Alone\? You trade with the AI band/);
    await A.fill('#nameInput', 'Solo'); await A.click('#joinBtn');
    await A.waitForSelector('#hostControls:not([hidden])', { state: 'attached' });   // started the room: running the band
    assert.equal(await A.getAttribute('[data-game="4"]', 'aria-checked'), 'true', 'the room starts in BARS 4');
    assert.match(await A.evaluate(() => window.getInvite()), /&g=4/, 'the invite says which game');
    await A.waitForFunction(() => /Slow funk/.test(document.getElementById('arrTitle').textContent), null, { timeout: 20000 });
    await h.drawer(A, 'band'); await A.click('[data-take="guitar"]');
    await A.click('#playBtn');
    await A.waitForFunction(() => window.jamStems.playing(), null, { timeout: 15000 });

    const t0 = await A.evaluate(() => window.jamStart.base), turn = 4 * 4 * 60000 / 96;   // 4 bars at 96 bpm
    const peek = () => A.evaluate(() => ({ line: document.getElementById('turnLine').textContent + ' · ' + document.getElementById('turnNext').textContent, bandGlow: document.getElementById('bandTile').classList.contains('onmic'),
      guitar: window.jamStems.gainOf('guitar'), piano: window.jamStems.gainOf('piano'), drums: window.jamStems.gainOf('drums'), solo: Object.assign({}, window.jamTrade.soloistState) }));
    const at = async k => { const w = t0 + (k + 0.6) * turn - await A.evaluate(() => performance.timeOrigin + performance.now()); if(w > 0) await sleep(w); return peek(); };
    const mine = await at(0), band = await at(1);
    assert.match(mine.line, /Your 4 bars · next: The band/);
    assert.ok(mine.guitar < 0.05, `your turn: the AI guitar is out (${mine.guitar})`);
    assert.ok(mine.drums > 0.9, 'the rest of the band keeps playing');
    assert.match(band.line, /The band is on · next: you/);
    assert.ok(band.bandGlow, 'the band tile glows on its turn');
    assert.ok(band.guitar > 0.5, `band's turn: the AI guitar covers for you (${band.guitar})`);
    assert.ok(band.solo.ready && band.solo.amp === 'clean', `band's turn: the AI soloist plays, through the Clean amp for funk (${JSON.stringify(band.solo)})`);
    assert.ok(band.solo.heardNotes >= 3 && band.solo.answered, `it heard your notes and answered them (${band.solo.heardNotes} notes heard)`);
    assert.ok(band.solo.scheduled >= 8, `a real phrase (${band.solo.scheduled} notes)`);
    assert.ok(band.piano < 1.2, 'no part pushed up front while the soloist plays');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
