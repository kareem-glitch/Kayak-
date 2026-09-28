// Latency test: finds the first frame at or after `from` where the microphone
// hears the test click (louder than the noise just before it). Posts that frame.
class Probe extends AudioWorkletProcessor {
  constructor(){ super(); this.from = Infinity; this.noise = 0; this.port.onmessage = e => { this.from = e.data.from; this.noise = 0; }; }
  process(inputs){
    const x = inputs[0] && inputs[0][0]; if(!x) return true;
    for(let k = 0; k < x.length; k++){
      const f = currentFrame + k, v = Math.abs(x[k]);
      if(f < this.from){ if(f > this.from - 4800 && v > this.noise) this.noise = v; continue; }   // the 100 ms before the click: how loud is the room?
      if(v > Math.max(0.03, this.noise * 3)){ this.port.postMessage({ frame: f }); this.from = Infinity; break; }
      if(f > this.from + 48000){ this.port.postMessage({ frame: null }); this.from = Infinity; break; }   // a second: nothing heard
    }
    return true;
  }
}
registerProcessor('latency-probe', Probe);
