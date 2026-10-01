// Runs on the audio thread.
//
// Capture: input 0 is your instrument (1 or 2 channels). Every 128-frame block
// is posted to the page, which sends it to the other players.
//
// Playback: one adaptive jitter buffer per other player, mixed to stereo.
//  - Each buffer is a ring of samples read at a slightly variable rate (±0.5%,
//    inaudible). The rate steers the fill level toward a target, which both
//    absorbs the small clock difference between two devices (drift) and lets
//    the target shrink without dropping chunks of audio.
//  - The target adapts: every second it creeps down toward the smallest fill
//    level seen (plus a safety margin); after a dropout it jumps up and holds
//    for ~10 s. It never goes below 5.7 ms or above the user's buffer limit.
//  - A dropout (buffer empty) is concealed by fading out the last sound instead
//    of a hard gap, and real audio fades back in.
const RING = 16384;            // samples per channel (~340 ms at 48 kHz)
const MAX_RATE_DEV = 0.005;    // ±0.5 % playback speed
const WINDOW = 375;            // render quanta per adaptation step (~1 s)
// How the buffer trades delay for smoothness ("feel", chosen by each player):
//  margin: samples of safety kept above the lowest fill
//  min:    smallest target; the audio thread takes a block per render, so surviving
//          one late packet needs two blocks buffered (256) plus the margin
//  hold:   adaptation steps (~1 s each) to keep the size after a dropout
//  shrink: max samples the target shrinks per step (grow fast, shrink slowly)
// Laptops use tight, phones balanced (set by the page; not a user option).
//  step:   how much the target grows after a dropout
// live: timing first (the default on computers): the smallest buffer that holds,
// smaller steps up after a dropout, quick back down; dropouts are faded, not clicks.
export const FEELS = {
  live:     { margin: 24,  min: 192, hold: 8,  shrink: 32, step: 64 },
  tight:    { margin: 16,  min: 256, hold: 8,  shrink: 24 },
  balanced: { margin: 48,  min: 272, hold: 10, shrink: 16 },
  smooth:   { margin: 128, min: 512, hold: 30, shrink: 8 },
};

class Player {
  constructor(limit, feel = FEELS.balanced){
    this.feel = feel;
    this.l = new Float32Array(RING); this.r = new Float32Array(RING);
    this.w = 0; this.rd = 0;                 // write index (int), read position (float)
    this.target = Math.max(192, feel.min); this.limit = limit;   // samples (the target starts at ~4-5 ms)
    this.playing = false; this.low = Infinity; this.n = 0;
    this.fade = 0; this.lastL = 0; this.lastR = 0; this.gain = 1;
    this.under = 0; this.rate = 1; this.hold = 0;
  }
  fill(){ return this.w - this.rd; }
  push(planes){
    const L = planes[0], R = planes[1] || planes[0];
    if(this.fill() + L.length > RING - 1) this.rd = this.w + L.length - (RING - 1);   // overflow: drop oldest
    for(let i = 0; i < L.length; i++){ const k = (this.w + i) & (RING - 1); this.l[k] = L[i]; this.r[k] = R[i]; }
    this.w += L.length;
  }
  // Mix 128 frames into outL/outR. Returns true if this player dropped out.
  render(outL, outR){
    const N = outL.length;
    if(!this.playing){
      if(this.fill() >= this.target){ this.playing = true; this.gain = 0; }   // primed: start with a fade-in
      else { this.conceal(outL, outR); return false; }
    }
    const f = this.fill();
    // steer the fill level toward the target by playing slightly faster or slower
    const err = (f - this.target) / Math.max(this.target, 128);
    this.rate = 1 + Math.max(-MAX_RATE_DEV, Math.min(MAX_RATE_DEV, err * 0.01));
    if(f < N * this.rate + 2){   // not enough audio: conceal, re-prime, aim higher
      this.under++; this.playing = false;
      this.target = Math.min(this.limit, this.target + (this.feel.step || 128)); this.hold = this.feel.hold;
      this.conceal(outL, outR); return true;
    }
    for(let i = 0; i < N; i++){
      const p = this.rd, i0 = Math.floor(p), t = p - i0, a = i0 & (RING - 1), b = (i0 + 1) & (RING - 1);
      if(this.gain < 1) this.gain = Math.min(1, this.gain + 1 / 64);
      const vl = (this.l[a] + (this.l[b] - this.l[a]) * t) * this.gain, vr = (this.r[a] + (this.r[b] - this.r[a]) * t) * this.gain;
      outL[i] += vl; outR[i] += vr; this.rd += this.rate;
    }
    const k = (Math.floor(this.rd) - 1) & (RING - 1); this.lastL = this.l[k]; this.lastR = this.r[k]; this.fade = 1;
    // adapt the target toward the lowest fill seen this window, plus a margin
    const after = this.fill(); if(after < this.low) this.low = after;
    if(++this.n >= WINDOW){
      const f = this.feel, spare = this.low - f.margin;
      if(this.hold > 0) this.hold--;
      else if(spare > 8) this.target = Math.max(f.min, this.target - Math.min(spare, f.shrink));
      else if(this.target < f.min) this.target = f.min;
      this.target = Math.min(this.target, this.limit);
      this.low = Infinity; this.n = 0;
    }
    return false;
  }
  // Fade the last sample value out over a few milliseconds instead of a click.
  conceal(outL, outR){
    for(let i = 0; i < outL.length && this.fade > 0.0005; i++){ this.fade *= 0.985; outL[i] += this.lastL * this.fade; outR[i] += this.lastR * this.fade; }
  }
}

// Far-apart mode: each block carries the audio frame it must sound at (a beat
// or a bar after it was played, on the shared clock), so the other players land
// exactly one beat/bar late: in time with the band, just not simultaneous.
// Blocks are written back to back; small clock drift is absorbed one sample at
// a time, a big jump (or the first block) re-anchors.
const DRING = 1 << 18;   // ~5.4 s at 48 kHz: room for a bar at 45 bpm
class DelayPlayer {
  constructor(){ this.l = new Float32Array(DRING); this.r = new Float32Array(DRING); this.e = null; this.drift = 0; this.late = 0; }
  push(planes, at, now){
    const L = planes[0], R = planes[1] || planes[0], n = L.length;
    at = Math.round(at);
    if(this.e === null || Math.abs(at - this.e) > 1200 || this.e < now){ this.e = at; this.drift = 0; }
    else {
      if(this.e - at > 256 && at >= now){ this.e = at; this.drift = 0; }   // running more than 5 ms behind schedule: jump back on time (timing over smoothness)
      this.drift = this.drift * 0.98 + (at - this.e) * 0.02;
      if(this.drift > 48){ const k = this.e & (DRING - 1); this.l[k] = L[0]; this.r[k] = R[0]; this.e++; this.drift--; }   // falling behind: repeat a sample
      else if(this.drift < -48){ this.e--; this.drift++; }                                                          // ahead: overwrite one
    }
    if(this.e + n <= now){ this.late++; this.e = now + n; }   // late: play it a moment late rather than drop it (gaps sound robotic)
    else if(this.e - now > DRING - 2 * n){ this.late++; this.e += n; return; }   // too far ahead to hold
    for(let i = 0; i < n; i++){ const k = (this.e + i) & (DRING - 1); this.l[k] = L[i]; this.r[k] = R[i]; }
    this.e += n;
  }
  render(outL, outR, frame){
    for(let i = 0; i < outL.length; i++){
      const k = (frame + i) & (DRING - 1), vl = this.l[k], vr = this.r[k];
      outL[i] += vl; outR[i] += vr; this.l[k] = 0; this.r[k] = 0;
    }
  }
}

class JamIO extends AudioWorkletProcessor {
  constructor(){
    super(); this.players = new Map(); this.delayed = new Map(); this.limit = 4 * 128; this.feel = FEELS.balanced; this.under = 0; this.t = 0; this.peak = 0;
    this.rec = null;   // recording: { frame, mic, out, n } batches of what you play and what you hear
    this.port.onmessage = e => {
      const d = e.data;
      if(d.planes && d.at !== undefined){ let p = this.delayed.get(d.id); if(!p){ p = new DelayPlayer(); this.delayed.set(d.id, p); } p.push(d.planes, d.at, currentFrame); }
      else if(d.planes){ let p = this.players.get(d.id); if(!p){ p = new Player(this.limit, this.feel); this.players.set(d.id, p); } p.push(d.planes); }
      else if(d.gone){ this.players.delete(d.gone); this.delayed.delete(d.gone); }
      else if(d.rec === true) this.rec = { frame: -1, mic: new Float32Array(128 * 64), out: new Float32Array(128 * 64), n: 0 };
      else if(d.rec === false){ this.flushRec(); this.rec = null; this.port.postMessage({ recDone: true }); }
      else if(d.feel){ this.feel = FEELS[d.feel] || FEELS.balanced; for(const p of this.players.values()){ p.feel = this.feel; p.hold = Math.min(p.hold, this.feel.hold); } }
      else if(d.limit){ this.limit = d.limit; for(const p of this.players.values()){ p.limit = d.limit; p.target = Math.min(p.target, d.limit); } }
    };
  }
  flushRec(){
    const r = this.rec; if(!r || !r.n) return;
    const mic = r.mic.slice(0, r.n * 128), out = r.out.slice(0, r.n * 128);
    this.port.postMessage({ recChunk: { frame: r.frame, mic, out } }, [mic.buffer, out.buffer]);
    r.frame += r.n * 128; r.n = 0;
  }
  process(inputs, outputs){
    const inp = inputs[0];
    // each block with the frame it was captured at, so the page can time-stamp it
    this.port.postMessage({ b: inp && inp.length ? inp.map(c => c.slice(0)) : [new Float32Array(128)], f: currentFrame });
    if(inp && inp[0]) for(let i = 0; i < 128; i++){ const a = Math.abs(inp[0][i]); if(a > this.peak) this.peak = a; }
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    L.fill(0); if(R !== L) R.fill(0);
    for(const p of this.players.values()) if(p.render(L, R)) this.under++;
    for(const p of this.delayed.values()) p.render(L, R, currentFrame);
    if(this.rec){   // your input exactly as captured, and the mix exactly as sent to your speakers
      const r = this.rec; if(r.frame < 0) r.frame = currentFrame;
      const mic = inp && inp[0], o = r.n * 128;
      for(let i = 0; i < 128; i++){ r.mic[o + i] = mic ? mic[i] : 0; r.out[o + i] = (L[i] + R[i]) / 2; }
      if(++r.n === 64) this.flushRec();
    }
    if(++this.t % 188 === 0){   // ~2x per second: stats for the page
      const players = {};
      for(const [id, p] of this.players) players[id] = { bufferMs: +(p.target / sampleRate * 1000).toFixed(1), rate: p.rate, under: p.under };
      for(const [id, p] of this.delayed) players[id] = Object.assign(players[id] || { bufferMs: 0 }, { late: p.late });
      this.port.postMessage({ under: this.under, players, peak: this.peak }); this.peak = 0;
    }
    return true;
  }
}
if(typeof registerProcessor === 'function') registerProcessor('jam-io', JamIO);
export { Player, DelayPlayer, JamIO };   // (FEELS is exported above)   // for unit tests (worklet scripts are ES modules, so this is allowed)
