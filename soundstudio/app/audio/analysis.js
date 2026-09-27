// Timing analysis for recordings: finds where notes/claps start (onsets) and
// measures them against the band's beats. Pure functions, no audio or DOM.

// Onset times (seconds) in a mono track: moments the level jumps well above
// what came just before. `minGap` stops one clap counting twice.
export function onsets(track, sr, { minGap = 0.12 } = {}){
  const win = Math.max(1, Math.round(sr * 0.001)), env = new Float32Array(Math.ceil(track.length / win));
  for(let i = 0; i < env.length; i++){ let m = 0; for(let j = i * win; j < Math.min(track.length, (i + 1) * win); j++){ const a = Math.abs(track[j]); if(a > m) m = a; } env[i] = m; }
  let peak = 0; for(const v of env) if(v > peak) peak = v;
  if(peak < 0.01) return [];
  const thresh = peak * 0.25, out = []; let last = -Infinity, before = 0;
  for(let i = 1; i < env.length; i++){
    before = before * 0.95 + env[i - 1] * 0.05;   // recent background level
    const t = i * win / sr;
    if(env[i] >= thresh && env[i] > before * 4 && t - last >= minGap){
      // refine to the first sample above half the local peak, for sub-ms timing
      let j = i * win, local = 0; for(let k = j; k < Math.min(track.length, j + win * 3); k++) local = Math.max(local, Math.abs(track[k]));
      let s = Math.max(0, (i - 1) * win); while(s < track.length && Math.abs(track[s]) < local * 0.5) s++;
      out.push(s / sr); last = t;
    }
  }
  return out;
}

// Offsets (ms) of each onset from its nearest beat; onsets far from any beat
// (more than 30% of a beat away) are ignored as off-beat playing.
export function beatOffsets(onsetTimes, beatTimes){
  if(beatTimes.length < 2) return [];
  const beat = (beatTimes[beatTimes.length - 1] - beatTimes[0]) / (beatTimes.length - 1), out = [];
  for(const t of onsetTimes){
    let best = Infinity; for(const b of beatTimes){ const d = t - b; if(Math.abs(d) < Math.abs(best)) best = d; }
    if(Math.abs(best) <= beat * 0.3) out.push(best * 1000);
  }
  return out;
}
// The same sounds picked up twice (your mic, and another player's mic heard
// through the app): for each onset in `a`, the first onset in `b` that follows
// within `maxGap` seconds. Returns the gaps in ms; their median is the delay.
export function pairGaps(a, b, maxGap = 0.4){
  const out = [];
  for(const t of a){ const m = b.find(u => u >= t - 0.002 && u - t <= maxGap); if(m !== undefined) out.push((m - t) * 1000); }
  return out;
}
// Loudest sample in a track (0..1), to tell a silent input from missed claps.
export const peak = track => { let m = 0; for(let i = 0; i < track.length; i++){ const a = Math.abs(track[i]); if(a > m) m = a; } return m; };
export const median = xs => { if(!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// 16-bit stereo WAV.
export function wav(left, right, sr){
  const n = left.length, buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf);
  const str = (o, s) => { for(let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
  for(let i = 0, o = 44; i < n; i++, o += 4){
    const l = Math.max(-1, Math.min(1, left[i])), r = Math.max(-1, Math.min(1, right[i]));
    dv.setInt16(o, l * 32767, true); dv.setInt16(o + 2, r * 32767, true);
  }
  return buf;
}
