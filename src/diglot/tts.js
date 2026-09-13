// Rendering a woven page to an audio file.
//
// The browser's own voices are free and instant but cannot be recorded — the
// Web Speech API gives you sound, not samples. So for a file you can put on a
// phone, this calls a cloud voice service with your own key.
//
// Each run goes to the voice of its own language, which is the whole point:
// send the diglot sentence to one voice and it reads "la casa" with an English
// accent. Same-language runs that sit next to each other are merged into one
// request to keep the call count (and the bill) down.

import { batchRuns } from './speech.js';

export const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google Cloud Text-to-Speech',
    keyLabel: 'API key',
    keyHint: 'An API key from a Google Cloud project with the Text-to-Speech API enabled. Cheapest of the two, and the only one here that can place exact silences.',
    exactSilence: true,
    defaults: { es: 'es-ES-Neural2-B', en: 'en-GB-Neural2-B' },
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    keyLabel: 'API key',
    keyHint: 'Best-sounding of the two, and its multilingual voices handle both languages. Pauses come out as natural phrasing rather than exact silence.',
    exactSilence: false,
    defaults: { es: '', en: '' },
  },
};

const escapeSsml = (s) => s.replace(/[<>&"']/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/**
 * Turn narration into an ordered list of voice requests. Pure — the tests run
 * it without touching the network.
 */
export function planRequests(sentences, { provider = 'google', maxChars = 900 } = {}) {
  const exact = PROVIDERS[provider]?.exactSilence;
  return batchRuns(sentences, { maxChars }).map((batch) => {
    const gap = batch.gapAfter || 0;
    let text = batch.text;
    let ssml = null;
    if (exact && gap >= 60) {
      ssml = `<speak>${escapeSsml(text)}<break time="${Math.round(gap)}ms"/></speak>`;
    } else if (gap >= 400) {
      // No break tag to lean on: ask for the pause with punctuation instead.
      text = text.replace(/[\s.]*$/, '') + '…';
    }
    return { lang: batch.lang, text, ssml, gapAfter: gap, from: batch.from, to: batch.to };
  });
}

/** Join audio chunks. MP3 is a stream of self-contained frames, so appending works. */
export function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

const base64ToBytes = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// ── providers ───────────────────────────────────────────────────────────────

async function googleSynthesize(request, { apiKey, voices, rate, signal }) {
  const voice = voices[request.lang] || PROVIDERS.google.defaults[request.lang];
  const languageCode = (voice.match(/^[a-z]{2}-[A-Z]{2}/) || [request.lang === 'es' ? 'es-ES' : 'en-GB'])[0];
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      input: request.ssml ? { ssml: request.ssml } : { text: request.text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: 'MP3', speakingRate: rate || 1 },
    }),
  });
  if (!res.ok) throw new Error(await describeError(res));
  const body = await res.json();
  if (!body.audioContent) throw new Error('Google returned no audio');
  return base64ToBytes(body.audioContent);
}

async function googleVoices({ apiKey, signal }) {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(apiKey)}`, { signal });
  if (!res.ok) throw new Error(await describeError(res));
  const body = await res.json();
  return (body.voices || []).map((v) => ({
    id: v.name,
    name: `${v.name} (${v.ssmlGender?.toLowerCase() || '—'})`,
    lang: (v.languageCodes || [''])[0],
  }));
}

async function elevenSynthesize(request, { apiKey, voices, signal }) {
  const voice = voices[request.lang];
  if (!voice) throw new Error(`Pick an ElevenLabs voice for ${request.lang === 'es' ? 'Spanish' : 'English'} first`);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        text: request.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) throw new Error(await describeError(res));
  return new Uint8Array(await res.arrayBuffer());
}

async function elevenVoices({ apiKey, signal }) {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey }, signal });
  if (!res.ok) throw new Error(await describeError(res));
  const body = await res.json();
  return (body.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name + (v.labels?.accent ? ` — ${v.labels.accent}` : ''),
    lang: '',
  }));
}

async function describeError(res) {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.detail?.message || body?.detail || detail;
  } catch { /* keep the status line */ }
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

const IMPLEMENTATIONS = {
  google: { synthesize: googleSynthesize, voices: googleVoices },
  elevenlabs: { synthesize: elevenSynthesize, voices: elevenVoices },
};

export function listVoices(provider, options) {
  const impl = IMPLEMENTATIONS[provider];
  if (!impl) throw new Error(`Unknown voice service: ${provider}`);
  return impl.voices(options);
}

/** Run tasks with a small amount of parallelism, keeping results in order. */
async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Render narration to a single MP3.
 * Returns { blob, requests, characters } — characters is what you'll be billed on.
 */
export async function renderAudio(sentences, {
  provider = 'google', apiKey, voices = {}, rate = 1, concurrency = 4, onProgress, signal,
} = {}) {
  const impl = IMPLEMENTATIONS[provider];
  if (!impl) throw new Error(`Unknown voice service: ${provider}`);
  if (!apiKey) throw new Error('Add an API key for the voice service first');

  const requests = planRequests(sentences, { provider });
  if (!requests.length) throw new Error('Nothing to read');

  let done = 0;
  const chunks = await mapWithLimit(requests, concurrency, async (request) => {
    const bytes = await impl.synthesize(request, { apiKey, voices, rate, signal });
    done += 1;
    onProgress?.({ done, total: requests.length });
    return bytes;
  });

  return {
    blob: new Blob([concatBytes(chunks)], { type: 'audio/mpeg' }),
    requests: requests.length,
    characters: requests.reduce((n, r) => n + r.text.length, 0),
  };
}

/** What a render will cost you, before you start it. */
export function estimate(sentences, { provider = 'google' } = {}) {
  const requests = planRequests(sentences, { provider });
  const characters = requests.reduce((n, r) => n + r.text.length, 0);
  return { requests: requests.length, characters, minutes: Math.round((characters / 950) * 10) / 10 };
}
