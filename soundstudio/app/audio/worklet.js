// Runs on the audio thread. Input 0 is your instrument/mic (mono): every
// 128-frame block is posted to the page, which sends it to the other players.
// Each other player has a small queue of received blocks; the queues are mixed
// to stereo. A queue that runs dry plays silence (counted as a dropout); a
// queue that grows past `max` blocks drops its oldest to bound the delay.
class JamIO extends AudioWorkletProcessor {
  constructor(){
    super(); this.q = new Map(); this.max = 4; this.under = 0;
    this.port.onmessage = e => {
      const d = e.data;
      if(d.planes){ let q = this.q.get(d.id); if(!q){ q = []; this.q.set(d.id, q); } q.push(d.planes); while(q.length > this.max) q.shift(); }
      else if(d.gone) this.q.delete(d.gone);
      else if(d.max) this.max = d.max;
    };
  }
  process(inputs, outputs){
    const mic = inputs[0][0];
    this.port.postMessage(mic ? mic.slice(0) : new Float32Array(128));
    const out = outputs[0]; out.forEach(c => c.fill(0));
    for(const q of this.q.values()){
      const blk = q.shift(); if(!blk){ this.under++; continue; }
      const m = blk[0], l = blk[1], r = blk[2] || blk[1];
      for(let i = 0; i < 128; i++){ out[0][i] += m[i] + (l ? l[i] : 0); if(out[1]) out[1][i] += m[i] + (r ? r[i] : 0); }
    }
    if(currentFrame % 4800 < 128) this.port.postMessage({ under: this.under });
    return true;
  }
}
registerProcessor('jam-io', JamIO);
