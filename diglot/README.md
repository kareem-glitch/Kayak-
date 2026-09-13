# Diglot 📖

Reads English text with Spanish woven into it, at whatever difficulty you set.
Drag the dial up and more of the words turn Spanish; drag it down and the text
softens back towards English. You learn the words from context, the way you
learned most of the English ones.

No accounts, no server, no build step. Everything runs in your browser, and the
things you read never leave your machine.

## Try it

```sh
npm run serve      # then open http://localhost:8080/diglot/
```

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
- **Listen** reads the page aloud, switching between a Spanish and an English
  voice mid-sentence so the Spanish sounds like Spanish.

## Getting text in

- **Paste** anything.
- **Web page** — give it a URL. The page is fetched through a public reader
  service (`r.jina.ai`, falling back to `allorigins`) because a browser cannot
  read another site directly. Paywalled pages generally won't work.
- **Write me one** — Claude writes an original article on a topic you name, then
  aligns its vocabulary. Needs an API key.
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

- `src/diglot/lexicon.js` — ~960 English→Spanish entries in ten difficulty bands.
- `src/diglot/morph.js` — Spanish inflection: plurals, agreement, articles, a
  conjugator with the irregulars that matter.
- `src/diglot/weave.js` — the engine. `analyze()` finds every swappable span
  once; `applyLevel()` decides and inflects on each slider move.
- `src/diglot/ingest.js` — URL fetching, readability, cleaning, splitting.
- `src/diglot/epub.js` — EPUB reader and writer, dependency-free (ZIP by hand,
  `DecompressionStream` for the inflating).
- `src/diglot/llm.js` — the optional Claude calls.
- `src/diglot/build.js` — bundles everything into `diglot/diglot.html`.
- `diglot/index.html`, `diglot/app.js` — the app.
- `test/diglot-*.test.js` — `npm test`.

## What it is not

A word-for-word weave teaches vocabulary, not word order — Spanish puts most
adjectives after the noun, and this keeps English structure so the sentence
stays readable. Treat it as a way to meet a few thousand words in context, not
as a grammar course.
