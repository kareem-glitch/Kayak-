// The AI soloist's ear and musical brain, as plain functions (no audio here, so
// they're unit-testable): hear a pitch, turn what was played into notes on the
// 16th-note grid, and answer it with a phrase in the song's key.

// ---- hearing: the pitch of a short stretch of audio (YIN), in Hz, or 0 ----
// x: mono samples at `rate` (a quarter of 48 kHz is plenty for guitar).
export function pitchOf(x, rate, lo = 70, hi = 1000){
  const n = x.length >> 1, tmin = Math.max(2, Math.floor(rate / hi)), tmax = Math.min(n - 2, Math.ceil(rate / lo));
  let energy = 0; for(let i = 0; i < x.length; i++) energy += x[i] * x[i];
  if(energy / x.length < 1e-5) return 0;   // silence
  // difference function, then its cumulative-mean normalised form (YIN steps 2 and 3)
  const d = new Float32Array(tmax + 2);
  for(let t = 1; t <= tmax + 1; t++){ let s = 0; for(let i = 0; i < n; i++){ const v = x[i] - x[i + t]; s += v * v; } d[t] = s; }
  const c = new Float32Array(tmax + 2); c[0] = 1; let run = 0;
  for(let t = 1; t <= tmax + 1; t++){ run += d[t]; c[t] = run ? d[t] * t / run : 1; }
  // the first dip under the threshold, followed to its bottom (step 4)
  let best = -1;
  for(let t = tmin; t <= tmax; t++) if(c[t] < 0.15){ while(t + 1 <= tmax && c[t + 1] < c[t]) t++; best = t; break; }
  if(best < 0) return 0;
  // parabolic interpolation around the dip for a finer period (step 5)
  const a = c[best - 1], b = c[best], e = c[best + 1], den = a - 2 * b + e;
  return rate / (best + (den ? 0.5 * (a - e) / den : 0));
}
export const midiOf = hz => hz > 0 ? Math.round(69 + 12 * Math.log2(hz / 440)) : 0;
export const hzOf = midi => 440 * Math.pow(2, (midi - 69) / 12);

// Pitch readings over time -> notes: a new note starts when the pitch changes
// (or sound starts). readings: [{ t: position in 16ths, midi (0 = silence) }].
export function notesFrom(readings){
  const out = []; let cur = null;
  for(const r of readings){
    if(!r.midi){ cur = null; continue; }
    if(!cur || cur.midi !== r.midi && r.t - cur.t >= 0.5){ cur = { t: r.t, pos: Math.round(r.t), midi: r.midi }; if(!out.length || out[out.length - 1].pos !== cur.pos) out.push({ pos: cur.pos, midi: cur.midi }); }
  }
  return out;
}

// ---- the key: scale notes to improvise with ----
const NAMES = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };
// "E minor", "A", "D minor", "F major", "Bb" -> root pitch class and a scale:
// minor keys and blues use minor pentatonic (+ the blue note), major keys major pentatonic.
export function scaleFor(key, style){
  const m = String(key || 'E minor').match(/^([A-G][#b]?)\s*(minor|min(?![a-z])|m(?![a-z]))?/i);
  const root = NAMES[m ? m[1][0].toUpperCase() + (m[1][1] || '') : 'E'] ?? 4;
  const minor = !!(m && m[2]) || /blues/i.test(style || '');
  return { root, steps: minor ? [0, 3, 5, 6, 7, 10] : [0, 2, 4, 7, 9] };
}
// The nearest scale note to `midi`, within a guitar-lead range (E3..E5).
export function snap(midi, scale){
  let best = midi, dist = 99;
  for(let m = midi - 3; m <= midi + 3; m++) if(scale.steps.includes(((m - scale.root) % 12 + 12) % 12) && Math.abs(m - midi) < dist){ best = m; dist = Math.abs(m - midi); }
  while(best < 52) best += 12; while(best > 76) best -= 12;
  return best;
}
const degreeNotes = scale => { const out = []; for(let m = 52; m <= 76; m++) if(scale.steps.includes(((m - scale.root) % 12 + 12) % 12)) out.push(m); return out; };

// A small seeded random source, so every device plays the same answer.
export const rng = seed => { let s = (seed >>> 0) || 1; return () => (s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296; };

// Stock rhythms (16th positions in a bar) and melodic shapes (steps along the scale).
const RHYTHMS = [[0, 2, 3, 6, 8, 10], [0, 3, 6, 8, 11, 12], [2, 4, 6, 7, 10, 12, 14], [0, 1, 2, 4, 8, 12], [0, 6, 8, 9, 10, 14]];
const SHAPES = [[0, 1, 2, 1, 0, -1, 0], [3, 2, 1, 0, -1, 0, 1], [0, 2, 1, 3, 2, 1, 0], [4, 3, 2, 3, 1, 0, -1], [0, -1, 0, 2, 3, 2, 1]];

// The answer to a phrase: notes [{ pos (16ths from the start of the AI's turn), midi, len (16ths) }].
//  - if you played something, it keeps your rhythm and flips your melody's
//    shape (up becomes down) in the song's key: call and response;
//  - otherwise it plays a stock lick;
//  - every two bars end on a longer note, and the last one on the root.
export function answer({ heard = [], bars = 4, scale, seed = 1 }){
  const r = rng(seed), pool = degreeNotes(scale);
  const idx = midi => { let b = 0; pool.forEach((m, i) => { if(Math.abs(m - midi) < Math.abs(pool[b] - midi)) b = i; }); return b; };
  // the call: your last two bars, positions relative to their first bar
  let call = null;
  if(heard.length >= 3){
    const last = heard[heard.length - 1].pos, recent = heard.filter(n => n.pos > last - 32);
    const from = Math.floor(recent[0].pos / 16) * 16;   // the bar you started that phrase in
    const two = recent.map(n => ({ pos: n.pos - from, i: idx(snap(n.midi, scale)) }));
    if(two.length >= 3) call = two;
  }
  const out = [];
  for(let b = 0; b < bars; b += 2){
    let cell;
    if(call){
      const pivot = call[0].i;   // mirror your melody around its first note
      cell = call.map(n => ({ pos: n.pos, i: pivot - (n.i - pivot) + (b % 4 === 2 ? 1 : 0) }));
    } else {
      const rh = RHYTHMS[Math.floor(r() * RHYTHMS.length)], sh = SHAPES[Math.floor(r() * SHAPES.length)], start = 3 + Math.floor(r() * 4);
      cell = rh.map((p, k) => ({ pos: p, i: start + sh[k % sh.length] })).concat(rh.slice(0, 4).map((p, k) => ({ pos: 16 + p, i: start + sh[(k + 2) % sh.length] - 1 })));
    }
    cell = cell.filter(n => n.pos < 30).sort((x, y) => x.pos - y.pos);
    // resolve: a longer note at the end of the pair, on the root for the final one
    const final = b + 2 >= bars, rootIdx = idx(snap(scale.root + 60, scale));
    cell.push({ pos: 28, i: final ? rootIdx : cell.length ? cell[cell.length - 1].i : rootIdx, len: 4 });
    cell.forEach((n, k) => {
      const i = Math.max(0, Math.min(pool.length - 1, n.i));
      const next = cell[k + 1];
      out.push({ pos: b * 16 + n.pos, midi: pool[i], len: n.len || Math.max(1, Math.min(4, (next ? next.pos : 32) - n.pos)) });
    });
  }
  return out.filter(n => n.pos < bars * 16);
}
