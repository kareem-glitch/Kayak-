// Re-pitches and re-times a stem off the main thread (the jam's timing lives there).
// tempo: new speed / old speed; semis: pitch shift. Pitch and speed are
// independent: WSOLA time-stretch (pitch kept), then a resample for the pitch.
// msg: { id, channels: [Float32Array...], tempo, semis } -> { id, channels }
self.onmessage = e => {
  const { id, channels, tempo, semis } = e.data;
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
    for(let d = -TOL; d <= TOL; d += 4){
      const s = nominal + d; if(s < 0 || s + N > x.length || want + N > x.length) continue;
      let sc = 0; for(let i = 0; i < HS; i += 8) sc += x[s + i] * x[want + i];
      if(sc > bestScore){ bestScore = sc; best = s; }
    }
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
