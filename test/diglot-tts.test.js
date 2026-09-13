import test from 'node:test';
import assert from 'node:assert/strict';
import { weave } from '../src/diglot/weave.js';
import { buildNarration } from '../src/diglot/speech.js';

import { planRequests, concatBytes, estimate, PROVIDERS } from '../src/diglot/tts.js';

const narrate = (text, opts = {}) => buildNarration(weave(text, { level: 40 }).nodes, opts).sentences;

test('every request is in one language only', () => {
  const requests = planRequests(narrate('The old woman opened the door of her small house.'));
  assert.ok(requests.length > 1);
  for (const request of requests) assert.match(request.lang, /^(es|en)$/);
});

test('Google gets exact silences as SSML breaks', () => {
  const requests = planRequests(narrate('The woman waited.', { echo: 'none', wordGap: 800 }), { provider: 'google' });
  const paused = requests.find((r) => r.gapAfter >= 700);
  assert.ok(paused, 'expected a shadowing gap');
  assert.match(paused.ssml, /<break time="800ms"\/>/);
  assert.match(paused.ssml, /^<speak>/);
});

test('SSML escapes the text it wraps', () => {
  const sentences = narrate('The woman said "house" & waited.', { echo: 'none', wordGap: 800 });
  for (const request of planRequests(sentences, { provider: 'google' })) {
    if (request.ssml) assert.doesNotMatch(request.ssml.replace(/<\/?speak>|<break[^>]*\/>/g, ''), /[<>&]/);
  }
});

test('ElevenLabs has no break tag, so long gaps become phrasing', () => {
  const requests = planRequests(narrate('The woman waited.', { echo: 'none', wordGap: 800 }), { provider: 'elevenlabs' });
  const paused = requests.find((r) => r.gapAfter >= 700);
  assert.equal(paused.ssml, null);
  assert.match(paused.text, /…$/);
  assert.equal(PROVIDERS.elevenlabs.exactSilence, false);
});

test('an article never gets a shadowing gap', () => {
  const sentences = narrate('The house is here.', { echo: 'none', wordGap: 900 });
  const runs = sentences.flatMap((s) => s.runs);
  const article = runs.find((r) => r.kind === 'word' && /^(el|la|los|las)$/i.test(r.text));
  if (article) assert.equal(article.gapAfter, 0);
});

test('the estimate counts characters, which is what services bill for', () => {
  const text = 'The old woman opened the door of her small house and looked at the sea.';
  const bare = estimate(narrate(text, { echo: 'none' }), { provider: 'google' });
  const glossed = estimate(narrate(text, { echo: 'first' }), { provider: 'google' });
  assert.ok(bare.characters > 0);
  assert.ok(glossed.characters > bare.characters, 'the spoken glosses cost extra');
  assert.ok(glossed.requests > bare.requests, 'and they cost extra requests');
  assert.equal(typeof bare.minutes, 'number');
});

test('audio chunks concatenate in order', () => {
  const joined = concatBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3, 4, 5])]);
  assert.deepEqual([...joined], [1, 2, 3, 4, 5]);
});
