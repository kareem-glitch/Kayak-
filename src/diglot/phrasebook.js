// Situational phrases, in the same difficulty bands as the main lexicon.
//
// These matter more than their word count suggests. A word-for-word weave of
// "how much is it" gives you "cómo mucho es eso", which is not Spanish and not
// what anyone says. Phrases are matched before single words, so once the dial
// reaches their tier the whole chunk turns into the thing a person actually
// says at the till.

// Everyday nouns the scenes lean on. They live here rather than in the main
// lexicon because they belong to the same errand: tills, menus, platforms.
export const EVERYDAY_NOUNS = [
  // band 1
  [
    'bread|pan|n|m', 'cheese|queso|n|m', 'meat|carne|n|f', 'chicken|pollo|n|m',
    'egg|huevo|n|m', 'rice|arroz|n|m', 'fish|pescado|n|m', 'potato|patata|n|f', 'tomato|tomate|n|m',
    'apple|manzana|n|f', 'orange|naranja|n|f', 'lemon|limón|n|m', 'onion|cebolla|n|f',
    'salt|sal|n|f', 'sugar|azúcar|n|m', 'oil|aceite|n|m', 'soup|sopa|n|f',
    'salad|ensalada|n|f', 'cake|tarta|n|f', 'ice cream|helado|n|m',
    'breakfast|desayuno|n|m', 'lunch|comida|n|f', 'dinner|cena|n|f',
    'glass|vaso|n|m', 'plate|plato|n|m', 'fork|tenedor|n|m', 'knife|cuchillo|n|m',
    'spoon|cuchara|n|f', 'napkin|servilleta|n|f', 'menu|carta|n|f',
    'waiter|camarero|n|m', 'bill|cuenta|n|f', 'ticket|billete|n|m',
  ],
  // band 2
  [
    'station|estación|n|f', 'airport|aeropuerto|n|m', 'platform|andén|n|m',
    'seat|asiento|n|m', 'suitcase|maleta|n|f', 'bag|bolsa|n|f',
    'passport|pasaporte|n|m', 'wallet|cartera|n|f', 'card|tarjeta|n|f',
    'cash|efectivo|n|m', 'small change|cambio|n|m', 'receipt|recibo|n|m',
    'supermarket|supermercado|n|m', 'bakery|panadería|n|f',
    'chemist|farmacia|n|f', 'pharmacy|farmacia|n|f', 'square|plaza|n|f',
    'corner|esquina|n|f', 'toilet|baño|n|m', 'lift|ascensor|n|m',
    'floor|planta|n|f', 'reservation|reserva|n|f', 'password|contraseña|n|f',
    'taxi|taxi|n|m', 'bus stop|parada de autobús|n|f', 'timetable|horario|n|m',
    'throat|garganta|n|f', 'stomach|estómago|n|m', 'fever|fiebre|n|f',
    'life jacket|chaleco salvavidas|n|m', 'buoy|boya|n|f', 'tide|marea|n|f',
  ],
];

export const PHRASE_BANDS = [
  // ── Band 0 · the ones you use on day one ──────────────────────────────────
  [
    'hello|hola|phrase', 'hi|hola|phrase', 'goodbye|adiós|phrase',
    'good afternoon|buenas tardes|phrase', 'good evening|buenas tardes|phrase',
    'good night|buenas noches|phrase', 'see you later|hasta luego|phrase',
    'see you tomorrow|hasta mañana|phrase', 'see you soon|hasta pronto|phrase',
    'thanks|gracias|phrase', 'thank you very much|muchas gracias|phrase',
    "you're welcome|de nada|phrase", 'excuse me|perdone|phrase',
    "i'm sorry|lo siento|phrase", 'sorry|perdón|phrase',
    'yes please|sí, por favor|phrase', 'no thank you|no, gracias|phrase',
    'there is|hay|phrase', 'there are|hay|phrase', 'is there|hay|phrase',
    'is there room|hay sitio|phrase', 'there is room|hay sitio|phrase',
    'are there|hay|phrase', 'there was|había|phrase', 'there were|había|phrase',
  ],
  // ── Band 1 · meeting someone ──────────────────────────────────────────────
  [
    'how are you|qué tal|phrase', 'very well|muy bien|phrase',
    'and you|y tú|phrase', 'nice to meet you|encantado|phrase',
    'what is your name|cómo te llamas|phrase', "what's your name|cómo te llamas|phrase",
    'my name is|me llamo|phrase', 'where are you from|de dónde eres|phrase',
    'i am from|soy de|phrase', "i'm from|soy de|phrase", 'i live in|vivo en|phrase',
    'do you speak english|habla inglés|phrase',
    "i don't understand|no entiendo|phrase", "i don't know|no sé|phrase",
    'more slowly please|más despacio, por favor|phrase',
    'what time is it|qué hora es|phrase', 'at what time|a qué hora|phrase',
    'this morning|esta mañana|phrase', 'tonight|esta noche|phrase',
    'the weekend|el fin de semana|phrase', 'last night|anoche|phrase',
  ],
  // ── Band 2 · shops and tills ──────────────────────────────────────────────
  [
    'how much is it|cuánto cuesta|phrase', 'how much is that|cuánto es|phrase',
    'how much does it cost|cuánto cuesta|phrase',
    'too expensive|demasiado caro|phrase', 'i would like|quisiera|phrase',
    "i'd like|quisiera|phrase", 'i want|quiero|phrase',
    'do you have|tiene|phrase', "i'm looking for|estoy buscando|phrase",
    'a bit of|un poco de|phrase', 'a kilo of|un kilo de|phrase',
    'half a kilo|medio kilo|phrase', 'a bottle of|una botella de|phrase',
    'a glass of|un vaso de|phrase', 'a cup of|una taza de|phrase',
    'anything else|algo más|phrase', "that's all|eso es todo|phrase",
    'a bag please|una bolsa, por favor|phrase',
    'can i pay by card|puedo pagar con tarjeta|phrase',
    'in cash|en efectivo|phrase', 'the receipt|el recibo|phrase',
    'here you are|aquí tiene|phrase', 'one moment|un momento|phrase',
  ],
  // ── Band 3 · eating out, and asking the way ───────────────────────────────
  [
    'a table for two|una mesa para dos|phrase',
    'the menu please|la carta, por favor|phrase',
    'what do you recommend|qué me recomienda|phrase',
    'the dish of the day|el plato del día|phrase',
    'still water|agua sin gas|phrase', 'sparkling water|agua con gas|phrase',
    'a coffee with milk|un café con leche|phrase',
    'the bill please|la cuenta, por favor|phrase',
    'is service included|está incluido el servicio|phrase',
    'it was delicious|estaba delicioso|phrase',
    'i am vegetarian|soy vegetariano|phrase', "i'm vegetarian|soy vegetariano|phrase",
    'i am allergic to|soy alérgico a|phrase',
    'where is|dónde está|phrase', 'where are|dónde están|phrase',
    'how do i get to|cómo llego a|phrase', 'on the left|a la izquierda|phrase',
    'on the right|a la derecha|phrase', 'straight on|todo recto|phrase',
    'near here|cerca de aquí|phrase', 'far from here|lejos de aquí|phrase',
    'at the corner|en la esquina|phrase', 'next to|al lado de|phrase',
    'opposite|enfrente de|phrase', 'i am lost|me he perdido|phrase',
    'can you help me|puede ayudarme|phrase',
  ],
  // ── Band 4 · getting about, and staying somewhere ─────────────────────────
  [
    'a ticket to|un billete para|phrase',
    'a return ticket|un billete de ida y vuelta|phrase',
    'one way|solo ida|phrase', 'what time does it leave|a qué hora sale|phrase',
    'what time does it arrive|a qué hora llega|phrase',
    'which platform|qué andén|phrase', 'the next train|el próximo tren|phrase',
    'is this seat free|está libre este asiento|phrase',
    'how long does it take|cuánto se tarda|phrase',
    'to the airport please|al aeropuerto, por favor|phrase',
    'i have a reservation|tengo una reserva|phrase',
    'a double room|una habitación doble|phrase',
    'for two nights|para dos noches|phrase',
    'is breakfast included|está incluido el desayuno|phrase',
    'what time is breakfast|a qué hora es el desayuno|phrase',
    'the wifi password|la contraseña del wifi|phrase',
    'could you repeat that|puede repetirlo|phrase',
    'how do you say|cómo se dice|phrase', 'what does that mean|qué significa|phrase',
    'next week|la semana que viene|phrase', 'the day after tomorrow|pasado mañana|phrase',
  ],
  // ── Band 5 · when something is wrong ──────────────────────────────────────
  [
    'i do not feel well|no me encuentro bien|phrase',
    "i don't feel well|no me encuentro bien|phrase",
    'it hurts here|me duele aquí|phrase',
    'i have a headache|me duele la cabeza|phrase',
    'do you have something for|tiene algo para|phrase',
    'i need a doctor|necesito un médico|phrase',
    'call an ambulance|llame a una ambulancia|phrase',
    'i have lost|he perdido|phrase', 'it does not work|no funciona|phrase',
    "it doesn't work|no funciona|phrase", 'there is a problem|hay un problema|phrase',
    'what happened|qué ha pasado|phrase', 'do not worry|no se preocupe|phrase',
    "don't worry|no te preocupes|phrase", 'it does not matter|no importa|phrase',
    'i will call you|te llamo|phrase', 'what do you think|qué te parece|phrase',
    'it depends|depende|phrase', 'more or less|más o menos|phrase',
    'as soon as possible|lo antes posible|phrase', 'right away|enseguida|phrase',
  ],
];
