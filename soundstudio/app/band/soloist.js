// The AI soloist: in BARS, the band's turn is a guitar solo that answers
// whoever just played. It listens during their turn (pitch and rhythm, see
// phrase.js), then plays its answer on its own turn, on the band's clock.
// The voice is a plucked string (Karplus-Strong) through one of our own amps
// (tone.js), chosen for the style: Lead for rock, Crunch for blues, Clean
// with chorus for funk, soul and lo-fi.
import { S } from '../state.js';
import { clk } from '../util.js';
import { createToneChain } from '../audio/tone.js';
import { pitchOf, midiOf, notesFrom, scaleFor, answer } from './phrase.js';

export const state = { ready: false, scheduled: 0, heardNotes: 0, answered: false, amp: null };
let chain = null, out = null, loading = null, volumeDb = 0, playing = [], failedAt = 0, own = null;
// Its own audio context: the band's (Tone.js) wraps the browser's and can't load
// our amp's audio-thread code. Timing is by the wall clock, so it stays in step.
const ctx = () => own || (own = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 }));
const outLat = () => { const c = ctx(); return (c.outputLatency || 0) + (c.baseLatency || 0); };
const ampFor = style => /rock|metal|punk|grunge/i.test(style || '') ? 'lead' : /blues/i.test(style || '') ? 'crunch' : 'clean';
const FX = { lead: { reverb: 30, chorus: 0 }, crunch: { reverb: 25, chorus: 0 }, clean: { reverb: 30, chorus: 30 } };

async function ensure(){
  const amp = ampFor(S.arr && S.arr.style);
  if(chain && state.amp === amp) return;
  if(loading) return loading;
  if(Date.now() - failedAt < 15000) return;   // it failed a moment ago: don't hammer
  loading = (async () => {
    if(!chain){
      chain = await createToneChain(ctx());
      out = ctx().createGain(); chain.output.connect(out); out.connect(ctx().destination);
      if(ctx().state !== 'running') await ctx().resume();
      setVolume(volumeDb);
    }
    await chain.set(amp); chain.setEq(Object.assign({ bass: 0, mid: 0, treble: 0, level: -3 }, FX[amp]));
    state.amp = amp; state.ready = true;
  })().catch(e => { console.warn('soloist unavailable', e); state.ready = false; failedAt = Date.now(); }).finally(() => { loading = null; });
  return loading;
}
export const prepare = () => ensure();
export function setVolume(db){ volumeDb = db; if(out) out.gain.value = db === -Infinity ? 0 : Math.pow(10, db / 20) * 0.9; }

// ---- the voice: a plucked string, rendered once per note ----
const plucks = new Map();
function pluck(midi){
  if(plucks.has(midi)) return plucks.get(midi);
  const c = ctx(), sr = c.sampleRate, hz = 440 * Math.pow(2, (midi - 69) / 12), N = Math.max(2, Math.round(sr / hz)), len = Math.round(sr * 1.8);
  const buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
  let seed = midi * 7919 + 1, lp = 0;
  for(let i = 0; i < N; i++){ seed = (seed * 16807) % 2147483647; lp += 0.5 * ((seed / 1073741823.5 - 1) - lp); ring[i] = lp; }   // a pick: slightly softened noise
  const decay = 0.4985 + 0.0012 * Math.min(1, 55 / midi);   // lower strings ring a little longer
  for(let i = 0, k = 0; i < len; i++){ const cur = ring[k], nx = ring[(k + 1) % N]; d[i] = cur * 0.3; ring[k] = (cur + nx) * decay; k = (k + 1) % N; }
  plucks.set(midi, buf); return buf;
}

// ---- listening: whoever's turn it is, as notes on the 16th grid ----
// feed(planes, whenMs): a block of the soloist's audio and when it was played (on this band's timing).
const DOWN = 4, WIN = 1024, HOP = 512;
let buf = new Float32Array(0), bufAt = 0, readings = [], heardFor = null;
export function feed(who, planes, whenMs, sixteenth){
  if(sixteenth == null) return;
  if(who !== heardFor){ heardFor = who; readings = []; buf = new Float32Array(0); }
  const p = planes[0], small = new Float32Array(p.length / DOWN);
  for(let i = 0; i < small.length; i++){ let s = 0; for(let k = 0; k < DOWN; k++) s += p[i * DOWN + k]; small[i] = s / DOWN; }
  if(!buf.length) bufAt = whenMs;
  const next = new Float32Array(buf.length + small.length); next.set(buf); next.set(small, buf.length); buf = next;
  const rate = ctx().sampleRate / DOWN;
  while(buf.length >= WIN){
    const midi = midiOf(pitchOf(buf.subarray(0, WIN), rate));
    readings.push({ t: sixteenth(bufAt), midi });
    buf = buf.slice(HOP); bufAt += HOP / rate * 1000;
  }
  if(readings.length > 2000) readings = readings.slice(-2000);
}

// ---- playing: the answer, on the band's turn starting at startMs (this device's clock) ----
export async function play({ startMs, bars, sixteenthMs, seed }){
  stop();
  await ensure(); if(!state.ready) return;
  const heard = notesFrom(readings);
  state.heardNotes = heard.length; state.answered = heard.length >= 3;
  const notes = answer({ heard, bars, scale: scaleFor(S.arr && S.arr.key, S.arr && S.arr.style), seed });
  const c = ctx(), toAudio = wall => c.currentTime + (wall - clk()) / 1000 - outLat();
  for(const n of notes){
    const t = toAudio(startMs + n.pos * sixteenthMs); if(t < c.currentTime + 0.01) continue;
    const src = c.createBufferSource(), g = c.createGain(), end = t + n.len * sixteenthMs / 1000;
    src.buffer = pluck(n.midi); src.connect(g).connect(chain.input);
    g.gain.setValueAtTime(1, t); g.gain.setTargetAtTime(0, end, 0.04);
    src.start(t); src.stop(end + 0.3); playing.push(src);
  }
  state.scheduled = playing.length;
  readings = [];   // the next answer listens afresh
}
export function stop(){ playing.forEach(s => { try{ s.stop(); }catch(e){} }); playing = []; }
