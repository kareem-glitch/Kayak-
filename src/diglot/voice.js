// Where the sound comes from.
//
// Two backends behind one interface, so the player does not care which is
// speaking: the device's own voices (free, instant, robotic) and ElevenLabs
// (a real voice, your key, a network round trip per phrase).
//
// The round trip is the whole design problem. A diglot sentence is a stream of
// short runs — "la", "casa", "house" — and fetching each one when its turn
// comes would stutter. So runs are fetched ahead of the playhead and cached by
// their text, which also means the second read of a page costs nothing.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

export const ELEVEN_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 — best quality' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5 — faster, cheaper' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 — fastest' },
];

/** Turbo and Flash accept a language hint; Multilingual v2 detects it itself. */
const takesLanguage = (model) => /turbo|flash/.test(model || '');

// ── the device's own voices ─────────────────────────────────────────────────

function browserEngine({ voices = {}, onWarn } = {}) {
  const synth = (() => {
    try { return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null; } catch { return null; }
  })();
  const usable = (() => {
    try { return !!synth && typeof SpeechSynthesisUtterance === 'function'; } catch { return false; }
  })();
  const list = () => {
    try { return synth ? synth.getVoices() || [] : []; } catch { return []; }
  };

  function pick(lang, slot) {
    const all = list();
    const second = slot === 1 && lang === 'es' && voices.es2;
    const wanted = second || (lang === 'es' ? voices.es : voices.en);
    const voice = all.find((v) => v.name === wanted)
      || all.find((v) => v.lang.toLowerCase().startsWith(lang === 'es' ? 'es' : 'en'))
      || null;
    return { voice, pitch: slot === 1 && !second ? 0.78 : 1 };
  }

  let current = null;
  return {
    kind: 'browser',
    mergeRuns: false,
    get available() { return usable; },
    unlock() {},
    prefetch() {},
    hasSpanish: () => list().some((v) => v.lang.toLowerCase().startsWith('es')),
    describe() {
      if (!usable) return 'This browser will not let the page speak. Safari blocks it inside an embedded frame — open the page in its own tab.';
      if (!list().some((v) => v.lang.toLowerCase().startsWith('es'))) {
        return 'No Spanish voice installed — the Spanish will be read with an English accent. Add one in your system’s language settings.';
      }
      return '';
    },
    speak(run, { rate = 1 } = {}) {
      if (!usable) return Promise.resolve();
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(run.text);
        const { voice, pitch } = pick(run.lang, run.slot || 0);
        utterance.voice = voice;
        utterance.lang = voice?.lang || (run.lang === 'es' ? 'es-ES' : 'en-GB');
        utterance.rate = run.kind === 'gloss' ? Math.min(2, rate * 1.12) : rate;
        utterance.pitch = pitch;
        if (run.kind === 'gloss') utterance.volume = 0.72;
        let done = false;
        let watchdog = null;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(watchdog);
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = (e) => { onWarn?.(e?.error || 'speech error'); finish(); };
        current = utterance;
        try { synth.speak(utterance); } catch { finish(); }
        // Browsers drop onend more often than you would like — a phone locking,
        // a missing voice, Chrome's long-utterance bug. Move on regardless.
        const seconds = run.text.length / (11 * (utterance.rate || 1));
        watchdog = setTimeout(finish, Math.max(1200, seconds * 2200));
      });
    },
    stop() {
      current = null;
      try { synth?.cancel(); } catch { /* nothing to stop */ }
    },
  };
}

// ── ElevenLabs ──────────────────────────────────────────────────────────────

/** A small persistent cache, so a re-read costs nothing and a re-listen is instant. */
function audioStore() {
  let open = null;
  const ready = () => {
    if (open) return open;
    open = new Promise((resolve) => {
      try {
        const req = indexedDB.open('diglot-audio', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('clips');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return open;
  };
  return {
    async get(key) {
      const db = await ready();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const req = db.transaction('clips').objectStore('clips').get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    },
    async put(key, blob) {
      const db = await ready();
      if (!db) return;
      try {
        db.transaction('clips', 'readwrite').objectStore('clips').put(blob, key);
      } catch { /* quota, private mode */ }
    },
    async clear() {
      const db = await ready();
      if (!db) return;
      try { db.transaction('clips', 'readwrite').objectStore('clips').clear(); } catch { /* ignore */ }
    },
  };
}

/** At most `limit` requests in flight: accounts have small concurrency caps. */
function throttle(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { job, resolve, reject } = queue.shift();
    job().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (job) => new Promise((resolve, reject) => { queue.push({ job, resolve, reject }); next(); });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function elevenEngine({ apiKey, endpoint = '', model = ELEVEN_MODELS[0].id, voices = {}, onWarn } = {}) {
  const memory = new Map();          // key → Promise<Blob>
  const queue = throttle(3);
  const disk = audioStore();
  const audio = typeof Audio !== 'undefined' ? new Audio() : null;
  if (audio) audio.preload = 'auto';
  let currentUrl = null;
  let stopped = false;

  const voiceFor = (run) => {
    if (run.lang === 'es') return (run.slot === 1 && voices.es2) || voices.es;
    return voices.en;
  };
  const keyFor = (run) => `${model}|${voiceFor(run)}|${run.lang}|${run.text}`;

  async function request(run) {
    const voiceId = voiceFor(run);
    if (!voiceId) throw new Error(`Choose an ElevenLabs voice for ${run.lang === 'es' ? 'Spanish' : 'English'}`);
    const body = {
      text: run.text,
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
    };
    if (takesLanguage(model)) body.language_code = run.lang;

    // Through our own endpoint when the site provides one (the key stays on the
    // server); straight to ElevenLabs with the user's key otherwise.
    const viaProxy = !!endpoint;
    const url = viaProxy
      ? endpoint
      : `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    const headers = { 'content-type': 'application/json' };
    if (!viaProxy) headers['xi-api-key'] = apiKey;

    const send = () => fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(viaProxy ? { ...body, voice_id: voiceId } : body),
    });

    let res = await queue(send);
    if (res.status === 429 || res.status >= 500) {
      // Rate limited or a wobble: one patient retry before giving up.
      await wait(res.status === 429 ? 1500 : 600);
      res = await queue(send);
    }
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const problem = await res.json();
        detail = problem?.detail?.message || problem?.detail || problem?.error || detail;
      } catch { /* keep the status line */ }
      if (res.status === 429) detail = 'ElevenLabs is rate limiting — slow down, or use the device voices for now.';
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return res.blob();
  }

  function clip(run) {
    const key = keyFor(run);
    if (memory.has(key)) return memory.get(key);
    const pending = (async () => {
      const saved = await disk.get(key);
      if (saved) return saved;
      const blob = await request(run);
      disk.put(key, blob);
      return blob;
    })();
    memory.set(key, pending);
    pending.catch(() => memory.delete(key));   // let a failed fetch be retried
    return pending;
  }

  return {
    kind: 'elevenlabs',
    mergeRuns: true,
    get available() { return !!audio && (!!apiKey || !!endpoint); },
    hasSpanish: () => true,
    describe() {
      if (!audio) return 'This browser cannot play audio.';
      if (!apiKey && !endpoint) return 'Add your ElevenLabs key in Settings, or switch back to the device voices.';
      if (!voices.es || !voices.en) return 'Pick an ElevenLabs voice for each language in Settings.';
      return '';
    },
    /** Must run inside the click that starts playback, or iOS will not play. */
    unlock() {
      if (!audio) return;
      stopped = false;
      try { audio.src = SILENT_WAV; audio.play().catch(() => {}); } catch { /* ignore */ }
    },
    prefetch(runs) {
      for (const run of runs.slice(0, 4)) {
        try { clip(run).catch(() => {}); } catch { /* ignore */ }
      }
    },
    async speak(run, { rate = 1 } = {}) {
      if (!audio) return;
      let blob;
      try {
        blob = await clip(run);
      } catch (err) {
        onWarn?.(err.message);
        return;
      }
      if (stopped) return;
      await new Promise((resolve) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(blob);
        audio.src = currentUrl;
        audio.playbackRate = run.kind === 'gloss' ? Math.min(4, rate * 1.1) : rate;
        audio.volume = run.kind === 'gloss' ? 0.8 : 1;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          audio.onended = null;
          audio.onerror = null;
          resolve();
        };
        audio.onended = finish;
        audio.onerror = () => { onWarn?.('could not play that clip'); finish(); };
        audio.play().catch((err) => { onWarn?.(err.message); finish(); });
      });
    },
    stop() {
      stopped = true;
      try { audio?.pause(); } catch { /* ignore */ }
    },
    clearCache: () => { memory.clear(); return disk.clear(); },
  };
}

/** Build the engine the settings ask for, falling back to the device voices. */
/**
 * Group the runs a sentence is made of into what should actually be sent to a
 * voice. The device voices are free and instant, so they take one run at a
 * time and every word can be highlighted as it is said. A remote voice is
 * neither, so runs that sit flush against each other in the same language
 * become one clip — fewer requests, and "la vieja" spoken as a phrase rather
 * than two disconnected words. The chunk remembers the runs it covers, so the
 * highlight still lands on all of them.
 */
export function speechChunks(runs, { merge = false } = {}) {
  const single = (run, i) => ({ ...run, runs: [run], from: i, to: i });
  if (!merge) return runs.map(single);

  const chunks = [];
  runs.forEach((run, i) => {
    const last = chunks[chunks.length - 1];
    const joinable = last
      && last.lang === run.lang
      && last.kind === run.kind
      && last.speaker === run.speaker
      && !last.gapAfter;
    if (!joinable) { chunks.push(single(run, i)); return; }
    const glue = /^[\s,.;:!?…]/.test(run.text) || /\s$/.test(last.text) ? '' : ' ';
    last.text += glue + run.text;
    last.runs.push(run);
    last.to = i;
    last.gapAfter = run.gapAfter;
  });
  return chunks;
}

export function createVoice({ source = 'browser', ...options } = {}) {
  if (source === 'elevenlabs') {
    const engine = elevenEngine(options);
    if (engine.available) return engine;
  }
  return browserEngine(options);
}

/** The voices this device has installed, for the pickers in Settings. */
export function deviceVoices() {
  try {
    return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() || [] : [];
  } catch { return []; }
}

/** The voices on an ElevenLabs account, for the pickers in Settings. */
export async function elevenVoices({ apiKey, endpoint = '' } = {}) {
  const url = endpoint ? `${endpoint}?voices=1` : 'https://api.elevenlabs.io/v1/voices';
  const res = await fetch(url, { headers: endpoint ? {} : { 'xi-api-key': apiKey } });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const problem = await res.json();
      detail = problem?.detail?.message || problem?.detail || detail;
    } catch { /* keep the status line */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  const body = await res.json();
  return (body.voices || []).map((v) => ({
    id: v.voice_id,
    name: [v.name, v.labels?.accent, v.labels?.gender].filter(Boolean).join(' · '),
  }));
}
