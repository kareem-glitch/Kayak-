// Re-pitches and re-times a stem off the main thread (the jam's timing lives there).
// tempo: new speed / old speed; semis: pitch shift. Pitch and speed are
// independent: WSOLA time-stretch (pitch kept), then a resample for the pitch.
// msg: { id, channels: [Float32Array...], tempo, semis } -> { id, channels }
self.onmessage = e => {
  const { id, channels, tempo, semis, slice } = e.data;
  // drums (slice: samples per 16th note): cut on the 16th-note grid and put each slice
  // at its new time, so every hit stays exactly as recorded
  if(slice && semis === 0){ const out = channels.map(c => sliced(c, slice, tempo)); self.postMessage({ id, channels: out }, out.map(c => c.buffer)); return; }
  const p = Math.pow(2, semis / 12), f = p / tempo;   // stretch by f, then play back p times faster
  const mono = new Float32Array(channels[0].length);
  for(const c of channels) for(let i = 0; i < mono.length; i++) mono[i] += c[i] / channels.length;
  const plan = f === 1 ? null : wsolaPlan(mono, f);
  const out = channels.map(c => resample(plan ? apply(c, plan, f) : c, p, Math.round(c.length / tempo)));
  self.postMessage({ id, channels: out }, out.map(c => c.buffer));
};

const N = 2048, HS = N / 2, TOL = 256;   // ~43 ms grains, half overlap, ±5 ms search
const WIN = (() => { const w = new Float32Array(N); for(let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); return w; })();
// Where each output grain reads from: near its nominal place, nudged to line up with
// how the previous grain would have carried on (no phasey seams). Planned once on
// the mono mix and used for every channel, so the stereo image stays put.
function wsolaPlan(x, f){
  const ha = HS / f, grains = Math.ceil(x.length * f / HS) + 1, pos = new Int32Array(grains);
  let prev = 0;
  for(let k = 0; k < grains; k++){
    const nominal = Math.round(k * ha);
    if(k === 0){ pos[k] = 0; prev = 0; continue; }
    const want = prev + HS;   // natural continuation of the last grain
    let best = nominal, bestScore = -Infinity;
    const score = s => { let xy = 0, xx = 1e-9; for(let i = 0; i < HS; i += 4){ const a = x[s + i]; xy += a * x[want + i]; xx += a * a; } return xy / Math.sqrt(xx); };   // shape, not loudness
    for(let d = -TOL; d <= TOL; d += 4){
      const s = nominal + d; if(s < 0 || s + N > x.length || want + N > x.length) continue;
      const sc = score(s); if(sc > bestScore){ bestScore = sc; best = s; }
    }
    for(let d = -3; d <= 3; d++){ const s = best + d; if(s < 0 || s + N > x.length || want + N > x.length || d === 0) continue; const sc = score(s); if(sc > bestScore){ bestScore = sc; best = s; } }   // then to the sample
    pos[k] = Math.max(0, Math.min(x.length - N, best)); prev = pos[k];
  }
  return pos;
}
function apply(x, pos, f){
  const n = Math.round(x.length * f), y = new Float32Array(n + N), wsum = new Float32Array(n + N);
  for(let k = 0; k < pos.length; k++){
    const o = k * HS, s = pos[k];
    for(let i = 0; i < N && o + i < y.length; i++){ y[o + i] += (x[s + i] || 0) * WIN[i]; wsum[o + i] += WIN[i]; }
  }
  for(let i = 0; i < n; i++) if(wsum[i] > 1e-3) y[i] /= wsum[i];
  return y.subarray(0, n);
}
// Read x at speed p (p > 1: higher and shorter), to exactly len samples.
function resample(x, p, len){
  const y = new Float32Array(len);
  if(p === 1){ y.set(x.subarray(0, Math.min(len, x.length))); return y; }
  for(let i = 0; i < len; i++){ const t = i * p, a = Math.floor(t), fr = t - a; y[i] = (x[a] || 0) + ((x[a + 1] || 0) - (x[a] || 0)) * fr; }
  return y;
}

// Drums: each 16th-note slice is re-timed on its own and laid at its new place, so
// every hit lands on the grid exactly as recorded (stretching the whole part smears
// them). Slices overlap by 5 ms with a crossfade; a hit played a touch early sits in
// that overlap and comes through whole.
function sliced(x, slice, tempo){
  const len = Math.round(x.length / tempo), y = new Float32Array(len), X = 256, count = Math.ceil(x.length / slice);
  for(let k = 0; k < count; k++){
    // every slice starts X before its grid line (the first one on silence), so its hit is never at the very edge
    const a = Math.round(k * slice) - X, b = Math.min(x.length, Math.round((k + 1) * slice));
    const oa = Math.round(k * slice / tempo) - X, ob = Math.min(len, Math.round((k + 1) * slice / tempo));
    if(b <= a || ob <= oa) continue;
    const src = a >= 0 ? x.subarray(a, b) : (() => { const t = new Float32Array(b - a); t.set(x.subarray(0, b), -a); return t; })();
    const f = (ob - oa) / src.length;
    const seg = Math.abs(f - 1) < 1e-4 || src.length < 2 * N ? resample(src, 1 / f, ob - oa) : apply(src, wsolaPlan(src, f), f);
    const n = Math.min(ob - oa, seg.length), last = k === count - 1;
    for(let i = 0; i < n; i++){
      if(oa + i < 0) continue;
      let g = 1;
      if(k && i < X) g = i / X;
      if(!last && i >= n - X) g = Math.min(g, (n - i) / X);
      y[oa + i] += seg[i] * g;
    }
  }
  return y;
}
