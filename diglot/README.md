# Diglot 📖

Reads English text with Spanish woven into it, at whatever difficulty you set.
Drag the dial up and more of the words turn Spanish; drag it down and the text
softens back towards English. You learn the words from context, the way you
learned most of the English ones.

No accounts, no server, no build step. Everything runs in your browser, and the
things you read never leave your machine.

## Try it

Live at **https://diglot-sepia.vercel.app**.

Locally:

```sh
npm run serve      # then open http://localhost:8080/diglot/
```

To put your own copy up (static, no build step, no vercel.json):

```sh
VERCEL_API_KEY=… npm run deploy:diglot
```

That rebuilds the bundle and uploads it: the single file answers the bare
domain, the module version sits at `/diglot/`. If an alias returns a Vercel
login page it has Deployment Protection switched on — turn it off in the
project's settings, or use an alias that doesn't.

Or open `diglot/diglot.html` — the same app bundled into one self-contained
file you can email to yourself or drop on any host. (Downloads are blocked in
some browsers when a page is opened from `file://`, so use the served version
if you want to export EPUBs.)

## How the dial works

Every word in the built-in lexicon has a difficulty rank, from *casa* at the
easy end to *no obstante* at the hard end. The dial is a threshold on that
rank, which gives it a property worth having: **raising the dial only ever adds
Spanish**. A word you met at 20% is still there at 60%, so the text you're
reading stays familiar as it gets harder.

The engine is not a find-and-replace. It reads the English around each word
before swapping it:

| English | Woven | Why |
|---|---|---|
| the small house | **la pequeña casa** | article and adjective agree with *casa* |
| the children were happy | los niños were **felices** | adjective agrees with the subject, across the verb |
| the plans of the company changed | los planes de la empresa **cambiaron** | plural subject, not *company* |
| the man who **lives** here | el hombre who **vive** here | verb, not the plural of *life* |
| she had **used** it | she had **usado** it | participle after *had*, not preterite |
| Maria and Carlos **left** | Maria y Carlos **salieron** | compound subject |
| **one** night | **una** noche | numeral agrees with the noun |
| a **good** day | un **buen** día | apocope before a masculine noun |
| of the world | **del** mundo | contraction |

Proper nouns are left alone — *Madrid* stays *Madrid*.

## Reading

- **Click any Spanish word** for the English, its part of speech and difficulty,
  and a speaker button.
- **I know this** pins a word to Spanish permanently, even below its difficulty.
  Your known words are the real progress bar — the dial is just the default for
  everything else.
- **Too soon** keeps a word in English until you say otherwise.
- **Peek** (the button, or hold `P`) shows the English for everything at once.
- **← / →** nudge the dial; hold shift for bigger steps.
- **Listen** opens the player — see below.

## Listening

Press **Listen** and the page is read aloud, sentence by sentence, with the
current sentence highlighted and the word being spoken outlined. It follows you
down the page and rolls on into the next part of a book by itself.

Listening is the harder half. You cannot hover a word you missed, so the player
adds what the page doesn't need:

- **A spoken gloss.** The first time each Spanish word appears, an English voice
  says what it meant — quieter and a little quicker, so it reads as an aside
  rather than part of the sentence. Set it to every time, or off, in Settings.
- **Two voices.** Every Spanish word goes to a Spanish voice and everything else
  to an English one, so *la casa* is not read with an English accent. Pick the
  voices in Settings; the player warns you if no Spanish voice is installed.
- **A gap for shadowing.** Set a pause after each Spanish word — half a second,
  or a second and a half — and say the word back into it. Articles don't get one:
  a gap between *la* and *casa* helps nobody.

In a dialogue, each speaker gets their own voice. Transport: play/pause (space),
previous and next sentence (`,` and `.`), speed,
a scrubber, and a sleep timer. Move the difficulty dial mid-sentence and the
sentence starts again with the new wording. Stop, come back tomorrow, and Listen
picks up where you left off. ▶ in any word's popover starts reading from there.

### An MP3 you can take with you

Browser voices are free but cannot be recorded — the Web Speech API gives you
sound, not samples. So **Export → Audiobook** calls a cloud voice service with
your own key and hands back a single MP3: each Spanish word rendered by a
Spanish voice, each gloss by an English one, joined in order.

| | Google Cloud TTS | ElevenLabs |
|---|---|---|
| Cost | cheapest | dearer |
| Voice quality | good | best |
| Exact pauses | yes, via SSML breaks | no — pauses come out as phrasing |

The panel prices the job before you start it (characters, requests, rough
minutes) because both services bill by the character, and a spoken gloss on
every word roughly doubles it.

One honest caveat: **current Kindles will not play a sideloaded MP3.** The audio
is for your phone, the car, a run. The Kindle path is the EPUB above.

## Everyday scenes

Thirteen short dialogues for the situations you actually stand in — saying
hello, small talk on the stairs, the bakery, the market, the supermarket till,
ordering coffee, dinner out, asking the way, a train ticket, checking in,
the pharmacy, hiring a kayak, making plans on the phone.

Each scene works two ways.

**Read it** at your current setting, like anything else. Dialogue gets its own
treatment: the speaker labels are never translated, and in the player each
speaker gets their own voice — a second Spanish voice if you have one installed,
otherwise the same voice pitched down, so you can tell the two sides apart.

**Drill it.** Every scene carries its key phrases written out in full Spanish,
because at a till you don't want a word-by-word weave — you want the thing
people say. The drill reads the English, leaves a gap long enough to try it
yourself, then says the Spanish. The Spanish is blurred on screen until it's
spoken (or you tap the row), so you're recalling rather than reading. Gap
length, say-it-twice, and hide/show are all one click. There's also a drill
across every phrase in the book.

The phrases are in the lexicon too, so they fire in ordinary text: *how much is
it* becomes **cuánto cuesta**, not "cómo mucho es eso". Phrases are matched
before single words, and across a comma — "the bill, please" is
**la cuenta, por favor**.

## Getting text in

- **Paste** anything.
- **Web page** — give it a URL. The page is fetched through a public reader
  service (`r.jina.ai`, falling back to `allorigins`) because a browser cannot
  read another site directly. Paywalled pages generally won't work.
- **A list of them** — paste a whole reading list, one per line, mixing links
  and topics. Links are fetched; anything else is a topic Claude writes about.
  Each one becomes its own piece in the library, or tick the box to join them
  into a single document. A line that fails says why and the rest carry on;
  nothing hangs longer than twenty seconds on a dead link.
- **Write me one** — Claude writes an original article on a topic you name, or a
  **dialogue** with its own key phrases in full Spanish, ready to drill. Then it
  aligns the vocabulary. Needs an API key.
- **Book / file** — a DRM-free EPUB, `.txt`, `.md` or `.html`. The file is
  parsed in the browser (yes, including unzipping the EPUB) and split into
  reader-sized parts. Project Gutenberg is a good source.

## Kindle

Export gives you an EPUB woven at the dial's current setting, with each Spanish
word glossed the first time it appears and a vocabulary list at the end. Email
it to your `@kindle.com` address, or use the Send to Kindle app.

One-time setup on Amazon's side: **Preferences → Personal Document Settings**
gives you your Send-to-Kindle address, and the list of email addresses allowed
to send to it. Add your own address there first or Amazon will silently drop
the file.

There's also plain-text export, and a vocabulary CSV for Anki.

## The optional Claude layer

Everything above works with no key. Adding an Anthropic API key (Settings) buys
three things:

1. **Enrich** — Claude reads the loaded text and returns the Spanish for *its*
   vocabulary, in context, each word rated for difficulty. A piece about sailing
   gets its sailing words. Those entries join the dial at the tier Claude gave
   them, so the slider stays instant and local: Claude builds the dictionary,
   your browser does the weaving.
2. **Write me one** — original articles to order.
3. Idioms and phrasal verbs the built-in list can't cover.

The key lives in your browser's local storage and is sent only to
`api.anthropic.com`.

## Layout

- `src/diglot/lexicon.js` — the word list, in ten difficulty bands.
- `src/diglot/phrasebook.js` — situational phrases and everyday nouns, in the
  same bands. Together about 1,150 entries.
- `src/diglot/scenes.js` — the thirteen dialogues and their key phrases.
- `src/diglot/morph.js` — Spanish inflection: plurals, agreement, articles, a
  conjugator with the irregulars that matter.
- `src/diglot/weave.js` — the engine. `analyze()` finds every swappable span
  once; `applyLevel()` decides and inflects on each slider move.
- `src/diglot/speech.js` — narration: sentence splitting, spoken glosses, the
  runs and silences. The reader draws from this too, so the highlight always
  matches the voice.
- `src/diglot/tts.js` — rendering narration to MP3 through a cloud voice service.
- `src/diglot/ingest.js` — URL fetching, readability, cleaning, splitting.
- `src/diglot/epub.js` — EPUB reader and writer, dependency-free (ZIP by hand,
  `DecompressionStream` for the inflating).
- `src/diglot/llm.js` — the optional Claude calls.
- `src/diglot/build.js` — bundles everything into `diglot/diglot.html`.
- `diglot/index.html`, `diglot/app.js` — the app.
- `test/diglot-*.test.js` — `npm test` (53 tests).

## What it is not

A word-for-word weave teaches vocabulary, not word order — Spanish puts most
adjectives after the noun, and this keeps English structure so the sentence
stays readable. Treat it as a way to meet a few thousand words in context, not
as a grammar course.
