// Record & check timing. Each device records what its player actually hears,
// on one timeline of "when it happened in your room":
//   left  = your instrument, moved earlier by your device's input + output
//           delay so it sits where you actually played it
//   right = the other players, when they reached your ears
//   both  = a soft click on every beat of the band, when it sounded in your room
// If the band was playing, onsets (claps, notes) are measured against the beat.
import { S } from './state.js';
import * as audio from './audio/io.js';
import * as band from './band/engine.js';
import { onsets, beatOffsets, median, wav } from './audio/analysis.js';

export const MAX_SECONDS = 120;
export const start = () => audio.startRecording();
export const seconds = () => audio.recordedSeconds();

export async function stop(){
  const inMs = audio.inputLatencyMs(), outMs = audio.outputLatencyMs();
  const { mic, out, sampleRate: sr, heardAt } = await audio.stopRecording();
  const n = out.length, you = new Float32Array(n);
  const shift = Math.round((inMs + outMs) / 1000 * sr);   // captured this many samples after you played
  for(let i = 0; i < n; i++) you[i] = i + shift < mic.length ? mic[i + shift] : 0;

  // the band's beats during the take, in seconds from the start of the take
  const beats = [], st = band.started;
  if(S.playing && st && S.arr){
    const beatMs = 60000 / S.arr.bpm, first = Math.ceil((heardAt - st.zero) / beatMs);
    for(let k = Math.max(first, 0); ; k++){ const t = (st.zero + k * beatMs - heardAt) / 1000; if(t > n / sr) break; if(t >= 0) beats.push(t); }
  }
  const left = you.slice(), right = out.slice();
  for(const b of beats){ const s = Math.round(b * sr); for(let i = 0; i < 480 && s + i < n; i++){ const c = 0.2 * Math.sin(2 * Math.PI * 1500 * i / sr) * Math.exp(-i / 120); left[s + i] += c; right[s + i] += c; } }
  const report = beats.length >= 4 ? {
    you: median(beatOffsets(onsets(you, sr), beats)),
    them: median(beatOffsets(onsets(out, sr), beats)),
  } : null;
  const url = URL.createObjectURL(new Blob([wav(left, right, sr)], { type: 'audio/wav' }));
  return { url, seconds: n / sr, report, beats: beats.length, correctedMs: inMs + outMs };
}
