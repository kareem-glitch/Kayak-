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
import { onsets, beatOffsets, pairGaps, peak, median, wav } from './audio/analysis.js';
import * as mixrec from './mixrec.js';
import * as tracks from './tracks.js';
import * as room from './net/room.js';

export const MAX_SECONDS = 300;   // 5 minutes (the raw capture for the timing check is held in memory)
// what: 'me' (your instrument, WAV), 'all' (everyone + band, audio file), 'video' (everyone + band + cameras)
let what = 'me';
let split = false, mixFailed = null;
// split: also keep each player (and the band) as its own track. The whole jam is
// also always captured that way, so if this browser/app can't record it as a
// compressed file (no MediaRecorder), it's mixed here and saved as a WAV instead.
export async function start(kind, alsoTracks = false){
  what = kind; split = alsoTracks && kind !== 'me'; mixFailed = null;
  if(kind !== 'me') tracks.start(id => (room.peers.get(id) || {}).name); audio.startRecording();   // always: the exact capture behind the timing check
  if(what !== 'me'){ try{ await mixrec.start({ video: what === 'video', screen: what === 'screen' }); }catch(e){ console.warn('mix recording unavailable', e); mixFailed = e; } }
  return what;
}
export const seconds = () => audio.recordedSeconds();
export const onScreenEnded = fn => { mixrec.hooks.screenEnded = fn; };

export async function stop(){
  const mix = what === 'me' || mixFailed ? null : mixrec.stop();
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
  const youOn = onsets(you, sr), themOn = onsets(out, sr), gaps = pairGaps(youOn, themOn);
  const report = {
    you: beats.length >= 4 ? median(beatOffsets(youOn, beats)) : null,
    them: beats.length >= 4 ? median(beatOffsets(themOn, beats)) : null,
    // side-by-side test: one clap reaches your mic and theirs at once, so the gap is the delay
    gap: gaps.length >= 3 ? median(gaps) : null, pairs: gaps.length,
    micSilent: peak(mic) < 0.01, othersSilent: peak(out) < 0.01,
  };
  const timingUrl = URL.createObjectURL(new Blob([wav(left, right, sr)], { type: 'audio/wav' }));
  const mixed = mix && await mix;
  const t = what !== 'me' ? await tracks.stop({ zip: split, mix: !mixed }) : null;
  const tracksUrl = t && t.zipUrl, wavMix = !mixed && t && t.mixUrl;
  const why = mixFailed && (mixFailed.name === 'NotAllowedError' ? 'the screen share was cancelled' : mixFailed.message || mixFailed);
  const note = mixFailed ? (what === 'video' ? 'Video recording isn’t available in this browser/app (' + why + '), so this is the whole jam as audio. Chrome records video.'
    : what === 'screen' ? 'The screen wasn’t recorded (' + why + '), so this is the whole jam as audio. Chrome records the screen: pick "This tab" when it asks.' : '') : '';
  split = false;
  const take = mixed || (wavMix ? { url: wavMix, type: 'audio/wav', ext: 'wav', video: false, note } : { url: URL.createObjectURL(new Blob([wav(you, you, sr)], { type: 'audio/wav' })), type: 'audio/wav', ext: 'wav', video: false });
  return { take, timingUrl, tracksUrl, seconds: n / sr, report, beats: beats.length, correctedMs: inMs + outMs };
}
