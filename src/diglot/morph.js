// Spanish morphology: just enough inflection to make woven words fit their
// English slot. Pure functions, no data beyond what's passed in.

const VOWELS = 'aeiouáéíóú';

/** Strip the accent from the last accented vowel (canción -> cancion). */
function deaccentLast(word) {
  const map = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };
  const i = [...word].reduce((best, ch, idx) => (map[ch] ? idx : best), -1);
  if (i === -1) return word;
  return word.slice(0, i) + map[word[i]] + word.slice(i + 1);
}

// Words that gain a written accent in the plural, because the stress stays put
// while the word grows a syllable.
const ACCENTED_PLURALS = {
  joven: 'jóvenes', examen: 'exámenes', imagen: 'imágenes', origen: 'orígenes',
  orden: 'órdenes', crimen: 'crímenes', resumen: 'resúmenes', margen: 'márgenes',
  volumen: 'volúmenes', carácter: 'caracteres', régimen: 'regímenes',
};

/** Pluralise a Spanish noun or adjective. */
export function pluralize(word) {
  if (!word) return word;
  const known = ACCENTED_PLURALS[word.toLowerCase()];
  if (known) return matchCase(known, word);
  const parts = word.split(' ');
  if (parts.length > 1) {
    // Pluralise the head noun of a phrase ("país vasco" -> "países vascos").
    return parts.map((p, i) => (i <= 1 ? pluralize(p) : p)).join(' ');
  }
  const last = word.slice(-1).toLowerCase();
  if (word.length > 2 && /ión$/i.test(word)) return deaccentLast(word) + 'es';
  if (last === 'z') return word.slice(0, -1) + 'ces';
  if (last === 's' || last === 'x') {
    // Already plural-looking and stressed on the last syllable? Leave it.
    return /[áéíóú]/.test(word.slice(-3)) ? word.slice(0, -1) + 'es' : word;
  }
  if (VOWELS.includes(last)) {
    if ('áéíóú'.includes(last)) return word + 's';
    return word + 's';
  }
  if (last === 'í' || last === 'ú') return word + 'es';
  return word + 'es';
}

/** Make an adjective agree with a noun's gender and number. */
export function agree(adj, gender = 'm', plural = false) {
  if (!adj) return adj;
  if (adj.includes(' ')) {
    const [head, ...rest] = adj.split(' ');
    return [agree(head, gender, plural), ...rest].join(' ');
  }
  let out = adj;
  const lower = adj.toLowerCase();
  if (gender === 'f') {
    if (lower.endsWith('o')) out = adj.slice(0, -1) + 'a';
    else if (/(dor|tor|ón|án|és)$/.test(lower)) out = deaccentLast(adj) + 'a';
  }
  return plural ? pluralize(out) : out;
}

/**
 * Apocope: a few adjectives lose their ending before a masculine singular noun
 * — "un buen día", not "un bueno día".
 */
export function apocopate(adj, gender, plural) {
  if (plural) return adj;
  const table = { bueno: 'buen', malo: 'mal', primero: 'primer', tercero: 'tercer', alguno: 'algún', ninguno: 'ningún' };
  const lower = adj.toLowerCase();
  if (gender === 'm' && table[lower]) return matchCase(table[lower], adj);
  if (lower === 'grande') return matchCase('gran', adj);
  return adj;
}

/** Definite / indefinite articles. */
export function article(kind, gender = 'm', plural = false, noun = '') {
  // "el agua", "un águila": a feminine noun beginning with a stressed a-
  // borrows the masculine singular article.
  if (gender === 'f' && !plural && /^(a|á|ha)/i.test(noun) && /^(agua|águila|alma|área|arma|aula|hambre|hacha|ala|ave)$/i.test(noun)) {
    gender = 'm';
  }
  const table = {
    definite: { m: ['el', 'los'], f: ['la', 'las'] },
    indefinite: { m: ['un', 'unos'], f: ['una', 'unas'] },
    demonstrative: { m: ['este', 'estos'], f: ['esta', 'estas'] },
    that: { m: ['ese', 'esos'], f: ['esa', 'esas'] },
  };
  const row = (table[kind] || table.definite)[gender === 'f' ? 'f' : 'm'];
  return row[plural ? 1 : 0];
}

/** Possessives inflect for number only (mi/mis), except nuestro. */
export function possessive(word, plural, gender = 'm') {
  if (!word) return word;
  if (word === 'nuestro') return agree('nuestro', gender, plural);
  return plural ? pluralize(word) : word;
}

const IRREGULAR = {
  ser: { pres1: 'soy', pres2: 'eres', pres1p: 'somos', pres3: 'es', pres3p: 'son', pret3: 'fue', pret3p: 'fueron', ger: 'siendo', part: 'sido' },
  estar: { pres1: 'estoy', pres2: 'estás', pres1p: 'estamos', pres3: 'está', pres3p: 'están', pret3: 'estuvo', pret3p: 'estuvieron', ger: 'estando', part: 'estado' },
  ir: { pres1: 'voy', pres2: 'vas', pres1p: 'vamos', pres3: 'va', pres3p: 'van', pret3: 'fue', pret3p: 'fueron', ger: 'yendo', part: 'ido' },
  tener: { pres1: 'tengo', pres2: 'tienes', pres1p: 'tenemos', pres3: 'tiene', pres3p: 'tienen', pret3: 'tuvo', pret3p: 'tuvieron', ger: 'teniendo', part: 'tenido' },
  hacer: { pres1: 'hago', pres2: 'haces', pres1p: 'hacemos', pres3: 'hace', pres3p: 'hacen', pret3: 'hizo', pret3p: 'hicieron', ger: 'haciendo', part: 'hecho' },
  decir: { pres1: 'digo', pres2: 'dices', pres1p: 'decimos', pres3: 'dice', pres3p: 'dicen', pret3: 'dijo', pret3p: 'dijeron', ger: 'diciendo', part: 'dicho' },
  poder: { pres1: 'puedo', pres2: 'puedes', pres1p: 'podemos', pres3: 'puede', pres3p: 'pueden', pret3: 'pudo', pret3p: 'pudieron', ger: 'pudiendo', part: 'podido' },
  querer: { pres1: 'quiero', pres2: 'quieres', pres1p: 'queremos', pres3: 'quiere', pres3p: 'quieren', pret3: 'quiso', pret3p: 'quisieron', ger: 'queriendo', part: 'querido' },
  ver: { pres1: 'veo', pres2: 'ves', pres1p: 'vemos', pres3: 've', pres3p: 'ven', pret3: 'vio', pret3p: 'vieron', ger: 'viendo', part: 'visto' },
  dar: { pres1: 'doy', pres2: 'das', pres1p: 'damos', pres3: 'da', pres3p: 'dan', pret3: 'dio', pret3p: 'dieron', ger: 'dando', part: 'dado' },
  saber: { pres1: 'sé', pres2: 'sabes', pres1p: 'sabemos', pres3: 'sabe', pres3p: 'saben', pret3: 'supo', pret3p: 'supieron', ger: 'sabiendo', part: 'sabido' },
  venir: { pres1: 'vengo', pres2: 'vienes', pres1p: 'venimos', pres3: 'viene', pres3p: 'vienen', pret3: 'vino', pret3p: 'vinieron', ger: 'viniendo', part: 'venido' },
  poner: { pres1: 'pongo', pres2: 'pones', pres1p: 'ponemos', pres3: 'pone', pres3p: 'ponen', pret3: 'puso', pret3p: 'pusieron', ger: 'poniendo', part: 'puesto' },
  salir: { pres1: 'salgo', pres2: 'sales', pres1p: 'salimos', pres3: 'sale', pres3p: 'salen', pret3: 'salió', pret3p: 'salieron', ger: 'saliendo', part: 'salido' },
  haber: { pres1: 'he', pres2: 'has', pres1p: 'hemos', pres3: 'hay', pres3p: 'hay', pret3: 'hubo', pret3p: 'hubo', ger: 'habiendo', part: 'habido' },
  volver: { pres1: 'vuelvo', pres2: 'vuelves', pres1p: 'volvemos', pres3: 'vuelve', pres3p: 'vuelven', pret3: 'volvió', pret3p: 'volvieron', ger: 'volviendo', part: 'vuelto' },
  pensar: { pres1: 'pienso', pres2: 'piensas', pres1p: 'pensamos', pres3: 'piensa', pres3p: 'piensan', pret3: 'pensó', pret3p: 'pensaron', ger: 'pensando', part: 'pensado' },
  empezar: { pres1: 'empiezo', pres2: 'empiezas', pres1p: 'empezamos', pres3: 'empieza', pres3p: 'empiezan', pret3: 'empezó', pret3p: 'empezaron', ger: 'empezando', part: 'empezado' },
  entender: { pres1: 'entiendo', pres2: 'entiendes', pres1p: 'entendemos', pres3: 'entiende', pres3p: 'entienden', pret3: 'entendió', pret3p: 'entendieron', ger: 'entendiendo', part: 'entendido' },
  dormir: { pres1: 'duermo', pres2: 'duermes', pres1p: 'dormimos', pres3: 'duerme', pres3p: 'duermen', pret3: 'durmió', pret3p: 'durmieron', ger: 'durmiendo', part: 'dormido' },
  pedir: { pres1: 'pido', pres2: 'pides', pres1p: 'pedimos', pres3: 'pide', pres3p: 'piden', pret3: 'pidió', pret3p: 'pidieron', ger: 'pidiendo', part: 'pedido' },
  seguir: { pres1: 'sigo', pres2: 'sigues', pres1p: 'seguimos', pres3: 'sigue', pres3p: 'siguen', pret3: 'siguió', pret3p: 'siguieron', ger: 'siguiendo', part: 'seguido' },
  jugar: { pres1: 'juego', pres2: 'juegas', pres1p: 'jugamos', pres3: 'juega', pres3p: 'juegan', pret3: 'jugó', pret3p: 'jugaron', ger: 'jugando', part: 'jugado' },
  encontrar: { pres1: 'encuentro', pres2: 'encuentras', pres1p: 'encontramos', pres3: 'encuentra', pres3p: 'encuentran', pret3: 'encontró', pret3p: 'encontraron', ger: 'encontrando', part: 'encontrado' },
  mostrar: { pres1: 'muestro', pres2: 'muestras', pres1p: 'mostramos', pres3: 'muestra', pres3p: 'muestran', pret3: 'mostró', pret3p: 'mostraron', ger: 'mostrando', part: 'mostrado' },
  contar: { pres1: 'cuento', pres2: 'cuentas', pres1p: 'contamos', pres3: 'cuenta', pres3p: 'cuentan', pret3: 'contó', pret3p: 'contaron', ger: 'contando', part: 'contado' },
  perder: { pres1: 'pierdo', pres2: 'pierdes', pres1p: 'perdemos', pres3: 'pierde', pres3p: 'pierden', pret3: 'perdió', pret3p: 'perdieron', ger: 'perdiendo', part: 'perdido' },
  sentir: { pres1: 'siento', pres2: 'sientes', pres1p: 'sentimos', pres3: 'siente', pres3p: 'sienten', pret3: 'sintió', pret3p: 'sintieron', ger: 'sintiendo', part: 'sentido' },
  morir: { pres1: 'muero', pres2: 'mueres', pres1p: 'morimos', pres3: 'muere', pres3p: 'mueren', pret3: 'murió', pret3p: 'murieron', ger: 'muriendo', part: 'muerto' },
  leer: { pres1: 'leo', pres2: 'lees', pres1p: 'leemos', pres3: 'lee', pres3p: 'leen', pret3: 'leyó', pret3p: 'leyeron', ger: 'leyendo', part: 'leído' },
  creer: { pres1: 'creo', pres2: 'crees', pres1p: 'creemos', pres3: 'cree', pres3p: 'creen', pret3: 'creyó', pret3p: 'creyeron', ger: 'creyendo', part: 'creído' },
  oír: { pres1: 'oigo', pres2: 'oyes', pres1p: 'oímos', pres3: 'oye', pres3p: 'oyen', pret3: 'oyó', pret3p: 'oyeron', ger: 'oyendo', part: 'oído' },
  traer: { pres1: 'traigo', pres2: 'traes', pres1p: 'traemos', pres3: 'trae', pres3p: 'traen', pret3: 'trajo', pret3p: 'trajeron', ger: 'trayendo', part: 'traído' },
  conocer: { pres1: 'conozco', pres2: 'conoces', pres1p: 'conocemos', pres3: 'conoce', pres3p: 'conocen', pret3: 'conoció', pret3p: 'conocieron', ger: 'conociendo', part: 'conocido' },
  construir: { pres1: 'construyo', pres2: 'construyes', pres1p: 'construimos', pres3: 'construye', pres3p: 'construyen', pret3: 'construyó', pret3p: 'construyeron', ger: 'construyendo', part: 'construido' },
  escribir: { pres1: 'escribo', pres2: 'escribes', pres1p: 'escribimos', pres3: 'escribe', pres3p: 'escriben', pret3: 'escribió', pret3p: 'escribieron', ger: 'escribiendo', part: 'escrito' },
  reír: { pres1: 'río', pres2: 'ríes', pres3: 'ríe', pres1p: 'reímos', pres3p: 'ríen', pret3: 'rio', pret3p: 'rieron', ger: 'riendo', part: 'reído' },
  sonreír: { pres1: 'sonrío', pres2: 'sonríes', pres3: 'sonríe', pres1p: 'sonreímos', pres3p: 'sonríen', pret3: 'sonrió', pret3p: 'sonrieron', ger: 'sonriendo', part: 'sonreído' },
  abrir: { pres1: 'abro', pres2: 'abres', pres1p: 'abrimos', pres3: 'abre', pres3p: 'abren', pret3: 'abrió', pret3p: 'abrieron', ger: 'abriendo', part: 'abierto' },
};

/**
 * Conjugate a Spanish infinitive.
 * form: 'inf' | 'pres3' | 'pres3p' | 'pret3' | 'pret3p' | 'ger' | 'part'
 */
export function conjugate(inf, form = 'inf') {
  if (!inf) return inf;
  if (form === 'inf') return inf;
  // Reflexives: conjugate the verb, drop the clitic.
  const reflexive = /se$/.test(inf) && inf.length > 4;
  const base = reflexive ? inf.slice(0, -2) : inf;
  const irr = IRREGULAR[base];
  if (irr && irr[form]) return prefixSe(irr[form], reflexive, form);
  const stem = base.slice(0, -2);
  const ending = base.slice(-2).toLowerCase().replace('í', 'i');
  const table = {
    ar: { pres1: 'o', pres2: 'as', pres3: 'a', pres1p: 'amos', pres3p: 'an', pret3: 'ó', pret3p: 'aron', ger: 'ando', part: 'ado' },
    er: { pres1: 'o', pres2: 'es', pres3: 'e', pres1p: 'emos', pres3p: 'en', pret3: 'ió', pret3p: 'ieron', ger: 'iendo', part: 'ido' },
    ir: { pres1: 'o', pres2: 'es', pres3: 'e', pres1p: 'imos', pres3p: 'en', pret3: 'ió', pret3p: 'ieron', ger: 'iendo', part: 'ido' },
  }[ending];
  if (!table) return inf;
  return prefixSe(stem + table[form], reflexive, form);
}

function prefixSe(word, reflexive, form) {
  if (!reflexive) return word;
  if (form === 'ger') return word + 'se';
  return 'se ' + word;
}

/** Copy the capitalisation pattern of `model` onto `word`. */
export function matchCase(word, model) {
  if (!model || !word) return word;
  if (model === model.toUpperCase() && model.length > 1 && /[A-Z]/.test(model)) return word.toUpperCase();
  if (model[0] === model[0].toUpperCase() && model[0] !== model[0].toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}
