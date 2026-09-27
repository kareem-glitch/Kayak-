// Your audio: in a browser, Web Audio (web-io.js); inside the desktop app, the
// app's native low-latency engine (native-io.js). Same exports either way, and
// the desktop app loads this same website, so both always run the same code.
const m = await import(window.__SS_NATIVE ? './native-io.js' : './web-io.js');
export const {
  NATIVE, RATE, FRAMES, BLOCK_MS, micOptions, isPhone, stats, context, start, startRecording, stopRecording, recordedSeconds,
  deliver, forget, setFeel, setBufferLimit, connectMic, setInputChannel, useInput, currentInputId, setMicEnabled, micEnabled,
  canChooseOutput, useOutput, listDevices, inputLatencyMs, inputSampleRate, echoCancelling, outputLatencyMs,
} = m;
