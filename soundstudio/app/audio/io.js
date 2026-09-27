// Your side of the audio: a 48 kHz AudioContext with the jam worklet, the
// instrument/mic input (device + channel), the output device, and the mix of
// what the other players send. Packets are handled by net/room.js; this module
// only deals in 128-frame blocks of Float32 samples.
export const RATE = 48000, FRAMES = 128, BLOCK_MS = FRAMES / RATE * 1000;
export const MIC_OPTS = { echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:{ ideal:2 } };

let ctx = null, node = null, micGain = null, micStream = null, micNodes = [], inputChannel = '1';
export const stats = { under: 0, players: {} };   // players: id -> { bufferMs, rate, under }
let onBlock = () => {};   // called with each captured block: [mono] or [left, right]

export const context = () => ctx;
export async function start(stream, blockHandler){
  onBlock = blockHandler;
  // Computers: ask for the smallest audio buffer the browser allows. Phones keep
  // the default, which is less prone to glitches on slower hardware.
  const phone = matchMedia('(pointer:coarse)').matches;
  ctx = new AudioContext({ sampleRate:RATE, latencyHint: phone ? 'interactive' : 0 });
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
  node = new AudioWorkletNode(ctx, 'jam-io', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2] });
  node.connect(ctx.destination);
  micGain = ctx.createGain(); micGain.channelCountMode = 'explicit'; micGain.connect(node, 0, 0);
  if(stream.getAudioTracks().length) connectMic(new MediaStream(stream.getAudioTracks()));
  node.port.onmessage = e => { const d = e.data; if(d.under !== undefined){ stats.under = d.under; stats.players = d.players; } else onBlock(d); };
  await ctx.resume();
}

// Audio from another player: one block of planes ([mono] or [mono, L, R]).
export function deliver(id, planes){ node && node.port.postMessage({ id, planes }); }
export function forget(id){ node && node.port.postMessage({ gone:id }); }
// Upper limit for each player's adaptive buffer, in 128-frame blocks.
export function setBufferLimit(blocks){ node && node.port.postMessage({ limit:blocks * FRAMES }); }

// Input: which channel(s) of the device to send: '1', '2', 'mix' (1+2 as mono)
// or 'stereo' (1 and 2 as left and right). Returns the device's channel count
// so the UI can disable the picker for mono devices.
export function connectMic(stream){
  micNodes.forEach(n => { try{ n.disconnect(); }catch(e){} }); micNodes = [];
  micStream = stream;
  const src = ctx.createMediaStreamSource(stream);
  const chans = (stream.getAudioTracks()[0].getSettings().channelCount) || src.channelCount || 1;
  micGain.channelCount = inputChannel === 'stereo' && chans >= 2 ? 2 : 1;   // the worklet sends as many channels as it receives
  if(inputChannel === 'mix' || inputChannel === 'stereo' || chans < 2){ src.connect(micGain); micNodes = [src]; }
  else { const split = ctx.createChannelSplitter(2); src.connect(split); split.connect(micGain, inputChannel === '2' ? 1 : 0); micNodes = [src, split]; }
  return chans;
}
export function setInputChannel(ch){ inputChannel = ch; return micStream ? connectMic(micStream) : 1; }
export async function useInput(deviceId){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:Object.assign({}, MIC_OPTS, deviceId ? { deviceId:{ exact:deviceId } } : {}) });
  const old = micStream, chans = connectMic(stream);
  if(old && old !== stream) old.getAudioTracks().forEach(t => t.stop());
  return chans;
}
export const currentInputId = () => micStream && micStream.getAudioTracks()[0] && micStream.getAudioTracks()[0].getSettings().deviceId;
export function setMicEnabled(on){ if(micGain) micGain.gain.value = on ? 1 : 0; }
export const micEnabled = () => !micGain || micGain.gain.value !== 0;

// Output: switch every AudioContext on the page (ours and Tone.js's; see the
// constructor hook in index.html) so the band and the players move together.
export const canChooseOutput = () => 'setSinkId' in AudioContext.prototype;
export async function useOutput(deviceId){
  const all = [...new Set([ctx, ...(window.__audioContexts || [])].filter(Boolean))];
  await Promise.all(all.map(c => c.setSinkId ? c.setSinkId(deviceId || '').catch(() => {}) : null));
}
export async function listDevices(){
  const devs = await navigator.mediaDevices.enumerateDevices();
  const pick = kind => devs.filter(d => d.kind === kind && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || (kind === 'audioinput' ? 'Input ' : 'Output ') + (i + 1) }));
  return { inputs: pick('audioinput'), outputs: pick('audiooutput') };
}
const track = () => micStream && micStream.getAudioTracks()[0];
// How long your input takes to reach the page, as the browser reports it (Chrome
// gives the device latency; elsewhere we fall back to the context's base latency).
export const inputLatencyMs = () => { const l = track() && track().getSettings().latency; return Math.round((l || (ctx ? ctx.baseLatency : 0)) * 1000); };
export const inputSampleRate = () => track() && track().getSettings().sampleRate;
export const outputLatencyMs = () => ctx ? Math.round(((ctx.outputLatency || 0) + ctx.baseLatency) * 1000) : 0;
