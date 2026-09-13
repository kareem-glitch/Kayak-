// Everyday scenes: short dialogues for the situations you actually stand in.
//
// The dialogue is English, so the weaver can take it apart and hand it back at
// whatever difficulty you're on. The key phrases underneath are written out in
// full Spanish, because when you are at the till you don't want a word-by-word
// weave — you want the thing people say.
//
// A speaker line is "Name: what they said". The reader styles the name, the
// weaver leaves it alone, and the player gives each speaker their own voice.

export const SCENES = [
  {
    id: 'greetings',
    group: 'Everyday',
    title: 'Saying hello',
    blurb: 'Hello, goodbye, and the bit in the middle.',
    turns: [
      ['You', 'Good morning.'],
      ['Neighbour', 'Good morning. How are you?'],
      ['You', 'Very well, thank you. And you?'],
      ['Neighbour', 'Fine. Are you the new neighbour?'],
      ['You', 'Yes. My name is Kareem. Nice to meet you.'],
      ['Neighbour', 'Nice to meet you too. I am Elena. I live on the second floor.'],
      ['You', 'I am from Ireland. I do not speak much Spanish yet.'],
      ['Neighbour', 'You speak very well. More than you think.'],
      ['You', 'Thank you very much. See you tomorrow.'],
      ['Neighbour', 'See you tomorrow. Have a good day.'],
    ],
    phrases: [
      { en: 'Good morning.', es: 'Buenos días.' },
      { en: 'How are you?', es: '¿Qué tal?' },
      { en: 'Very well, thank you. And you?', es: 'Muy bien, gracias. ¿Y tú?' },
      { en: 'My name is Kareem.', es: 'Me llamo Kareem.' },
      { en: 'Nice to meet you.', es: 'Encantado.' },
      { en: 'I am from Ireland.', es: 'Soy de Irlanda.' },
      { en: 'I do not speak much Spanish.', es: 'No hablo mucho español.' },
      { en: 'Have a good day.', es: 'Que tengas un buen día.' },
    ],
  },
  {
    id: 'small-talk',
    group: 'Everyday',
    title: 'Small talk on the stairs',
    blurb: 'Weather, work, and getting away politely.',
    turns: [
      ['Elena', 'How is it going?'],
      ['You', 'Not bad. It is very hot today.'],
      ['Elena', 'Terrible. In August it is always like this.'],
      ['You', 'Is it better in September?'],
      ['Elena', 'A little. What do you do?'],
      ['You', 'I work in an office near the port. And you?'],
      ['Elena', 'I am a teacher. I work in the school on the corner.'],
      ['You', 'How long have you lived here?'],
      ['Elena', 'Twenty years. My family is from the north but I like this city.'],
      ['You', 'Sorry, I am late. See you later.'],
      ['Elena', 'See you later. Take care.'],
    ],
    phrases: [
      { en: 'How is it going?', es: '¿Qué tal?' },
      { en: 'It is very hot today.', es: 'Hace mucho calor hoy.' },
      { en: 'What do you do?', es: '¿A qué te dedicas?' },
      { en: 'I work in an office.', es: 'Trabajo en una oficina.' },
      { en: 'How long have you lived here?', es: '¿Cuánto tiempo llevas aquí?' },
      { en: 'Sorry, I am late.', es: 'Perdona, llego tarde.' },
      { en: 'See you later.', es: 'Hasta luego.' },
      { en: 'Take care.', es: 'Cuídate.' },
    ],
  },
  {
    id: 'bakery',
    group: 'Shops',
    title: 'At the bakery',
    blurb: 'Pointing, counting, and paying.',
    turns: [
      ['Baker', 'Good morning. What can I get you?'],
      ['You', 'Good morning. A loaf of bread, please.'],
      ['Baker', 'Big or small?'],
      ['You', 'Big, please. And two of those.'],
      ['Baker', 'The ones with almonds?'],
      ['You', 'Yes, those. Are they fresh?'],
      ['Baker', 'From this morning. Anything else?'],
      ['You', 'That is all, thank you. How much is that?'],
      ['Baker', 'Four euros twenty.'],
      ['You', 'Can I pay by card?'],
      ['Baker', 'Of course. Here you are. Have a good day.'],
    ],
    phrases: [
      { en: 'What can I get you?', es: '¿Qué le pongo?' },
      { en: 'A loaf of bread, please.', es: 'Una barra de pan, por favor.' },
      { en: 'Two of those, please.', es: 'Dos de esos, por favor.' },
      { en: 'Anything else?', es: '¿Algo más?' },
      { en: 'That is all, thank you.', es: 'Nada más, gracias.' },
      { en: 'How much is that?', es: '¿Cuánto es?' },
      { en: 'Can I pay by card?', es: '¿Puedo pagar con tarjeta?' },
      { en: 'Here you are.', es: 'Aquí tiene.' },
    ],
  },
  {
    id: 'market',
    group: 'Shops',
    title: 'At the market',
    blurb: 'Weights, ripeness, and one more thing.',
    turns: [
      ['Stallholder', 'Who is next?'],
      ['You', 'Me, I think. A kilo of tomatoes, please.'],
      ['Stallholder', 'For today or for the week?'],
      ['You', 'For today. Are they ripe?'],
      ['Stallholder', 'Very ripe. These are the best.'],
      ['You', 'Good. And half a kilo of those peppers.'],
      ['Stallholder', 'Anything else? The oranges are very good today.'],
      ['You', 'Go on then, four oranges. How much is it all?'],
      ['Stallholder', 'Six fifty. Do you need a bag?'],
      ['You', 'No thank you, I have one.'],
    ],
    phrases: [
      { en: 'Who is next?', es: '¿Quién es el último?' },
      { en: 'A kilo of tomatoes, please.', es: 'Un kilo de tomates, por favor.' },
      { en: 'Are they ripe?', es: '¿Están maduros?' },
      { en: 'Half a kilo of those.', es: 'Medio kilo de esos.' },
      { en: 'How much is it all?', es: '¿Cuánto es todo?' },
      { en: 'Do you need a bag?', es: '¿Necesita bolsa?' },
      { en: 'No thank you, I have one.', es: 'No, gracias, ya tengo.' },
    ],
  },
  {
    id: 'supermarket',
    group: 'Shops',
    title: 'At the supermarket till',
    blurb: 'The four sentences you will hear every single time.',
    turns: [
      ['You', 'Excuse me, where is the milk?'],
      ['Assistant', 'At the back, next to the cheese.'],
      ['You', 'Thank you.'],
      ['Cashier', 'Good afternoon. Do you have a loyalty card?'],
      ['You', 'No, I do not have one.'],
      ['Cashier', 'Do you need a bag?'],
      ['You', 'Yes, one please.'],
      ['Cashier', 'That is twenty three euros. Card or cash?'],
      ['You', 'Card. Sorry, can you repeat the number?'],
      ['Cashier', 'Twenty three. Enter your PIN, please.'],
      ['You', 'Done. Thank you very much.'],
      ['Cashier', 'To you. Good afternoon.'],
    ],
    phrases: [
      { en: 'Where is the milk?', es: '¿Dónde está la leche?' },
      { en: 'Do you have a loyalty card?', es: '¿Tiene tarjeta de fidelidad?' },
      { en: 'Do you need a bag?', es: '¿Necesita bolsa?' },
      { en: 'Card or cash?', es: '¿Con tarjeta o en efectivo?' },
      { en: 'Can you repeat that?', es: '¿Puede repetirlo?' },
      { en: 'Enter your PIN.', es: 'Marque su PIN.' },
      { en: 'Thank you very much.', es: 'Muchas gracias.' },
    ],
  },
  {
    id: 'coffee',
    group: 'Eating out',
    title: 'Ordering coffee',
    blurb: 'Here or away, and where the wifi lives.',
    turns: [
      ['Waiter', 'Good morning. What would you like?'],
      ['You', 'A coffee with milk, please.'],
      ['Waiter', 'To have here or to take away?'],
      ['You', 'Here, thank you. Do you have anything to eat?'],
      ['Waiter', 'Toast, or a slice of potato omelette.'],
      ['You', 'A slice of omelette then.'],
      ['Waiter', 'Anything else?'],
      ['You', 'No, that is all. Is there wifi?'],
      ['Waiter', 'Yes. The password is on the receipt.'],
      ['You', 'Perfect. Thank you very much.'],
    ],
    phrases: [
      { en: 'A coffee with milk, please.', es: 'Un café con leche, por favor.' },
      { en: 'To have here or to take away?', es: '¿Para tomar aquí o para llevar?' },
      { en: 'Do you have anything to eat?', es: '¿Tienen algo para comer?' },
      { en: 'A slice of omelette.', es: 'Un pincho de tortilla.' },
      { en: 'Is there wifi?', es: '¿Hay wifi?' },
      { en: 'The password is on the receipt.', es: 'La contraseña está en el recibo.' },
    ],
  },
  {
    id: 'restaurant',
    group: 'Eating out',
    title: 'Dinner out',
    blurb: 'A table, a recommendation, an allergy, the bill.',
    turns: [
      ['You', 'Good evening. A table for two, please.'],
      ['Waiter', 'Do you have a reservation?'],
      ['You', 'No, we do not. Is there room?'],
      ['Waiter', 'Yes, by the window. Here is the menu.'],
      ['You', 'Thank you. What do you recommend?'],
      ['Waiter', 'The fish is very good today. And the dish of the day is lamb.'],
      ['You', 'The fish for me. I am allergic to nuts, is that a problem?'],
      ['Waiter', 'No problem. I will tell the kitchen.'],
      ['You', 'And a bottle of still water, please.'],
      ['Waiter', 'Of course. Anything else?'],
      ['You', 'Later, thank you.'],
      ['You', 'That was delicious. The bill, please.'],
      ['Waiter', 'Right away. Is service included? Yes, it is included.'],
    ],
    phrases: [
      { en: 'A table for two, please.', es: 'Una mesa para dos, por favor.' },
      { en: 'Do you have a reservation?', es: '¿Tienen reserva?' },
      { en: 'What do you recommend?', es: '¿Qué me recomienda?' },
      { en: 'The dish of the day.', es: 'El plato del día.' },
      { en: 'I am allergic to nuts.', es: 'Soy alérgico a los frutos secos.' },
      { en: 'A bottle of still water.', es: 'Una botella de agua sin gas.' },
      { en: 'That was delicious.', es: 'Estaba delicioso.' },
      { en: 'The bill, please.', es: 'La cuenta, por favor.' },
    ],
  },
  {
    id: 'directions',
    group: 'Out and about',
    title: 'Asking the way',
    blurb: 'Left, right, straight on, and how far.',
    turns: [
      ['You', 'Excuse me, where is the station?'],
      ['Passer-by', 'The train station? It is near here.'],
      ['You', 'How do I get there?'],
      ['Passer-by', 'Straight on to the square, then left.'],
      ['You', 'To the left at the square.'],
      ['Passer-by', 'Yes. Then the second street on the right.'],
      ['You', 'How long does it take on foot?'],
      ['Passer-by', 'Ten minutes. Fifteen if you walk slowly.'],
      ['You', 'Sorry, more slowly please. My Spanish is not very good.'],
      ['Passer-by', 'Straight on. Then left. Then the second on the right.'],
      ['You', 'Now I understand. Thank you very much.'],
    ],
    phrases: [
      { en: 'Where is the station?', es: '¿Dónde está la estación?' },
      { en: 'How do I get there?', es: '¿Cómo llego?' },
      { en: 'Straight on, then left.', es: 'Todo recto y luego a la izquierda.' },
      { en: 'The second street on the right.', es: 'La segunda calle a la derecha.' },
      { en: 'How long does it take on foot?', es: '¿Cuánto se tarda a pie?' },
      { en: 'More slowly, please.', es: 'Más despacio, por favor.' },
      { en: 'Now I understand.', es: 'Ahora lo entiendo.' },
    ],
  },
  {
    id: 'train',
    group: 'Travel',
    title: 'Buying a train ticket',
    blurb: 'Return, platform, and the seat that is not yours.',
    turns: [
      ['You', 'Good morning. A return ticket to Seville, please.'],
      ['Clerk', 'For today?'],
      ['You', 'Yes, this morning. What time does the next train leave?'],
      ['Clerk', 'At ten forty. And back?'],
      ['You', 'In the evening, after seven.'],
      ['Clerk', 'There is one at seven thirty and one at nine.'],
      ['You', 'The one at seven thirty. How much is it?'],
      ['Clerk', 'Fifty two euros. Platform four.'],
      ['You', 'Thank you. Does it arrive on time?'],
      ['Clerk', 'Almost always.'],
      ['You', 'Excuse me, is this seat free?'],
      ['Passenger', 'No, sorry. My seat is twelve B.'],
    ],
    phrases: [
      { en: 'A return ticket to Seville, please.', es: 'Un billete de ida y vuelta a Sevilla, por favor.' },
      { en: 'What time does the next train leave?', es: '¿A qué hora sale el próximo tren?' },
      { en: 'Which platform?', es: '¿Qué andén?' },
      { en: 'Does it arrive on time?', es: '¿Llega a tiempo?' },
      { en: 'Is this seat free?', es: '¿Está libre este asiento?' },
      { en: 'I have missed my train.', es: 'He perdido el tren.' },
    ],
  },
  {
    id: 'hotel',
    group: 'Travel',
    title: 'Checking in',
    blurb: 'Reservation, breakfast, and what time you have to be out.',
    turns: [
      ['You', 'Good afternoon. I have a reservation.'],
      ['Receptionist', 'In what name?'],
      ['You', 'Kareem. A double room for two nights.'],
      ['Receptionist', 'Here it is. Your passport, please.'],
      ['You', 'Here you are. Is breakfast included?'],
      ['Receptionist', 'Yes, from seven to ten, on the first floor.'],
      ['You', 'And what time do we have to leave the room?'],
      ['Receptionist', 'Before twelve. Room two-o-four, here is the key.'],
      ['You', 'One more thing. What is the wifi password?'],
      ['Receptionist', 'It is on the card, under the number.'],
      ['You', 'Perfect. Thank you very much.'],
    ],
    phrases: [
      { en: 'I have a reservation.', es: 'Tengo una reserva.' },
      { en: 'In what name?', es: '¿A nombre de quién?' },
      { en: 'A double room for two nights.', es: 'Una habitación doble para dos noches.' },
      { en: 'Is breakfast included?', es: '¿Está incluido el desayuno?' },
      { en: 'What time do we have to leave the room?', es: '¿A qué hora hay que dejar la habitación?' },
      { en: 'What is the wifi password?', es: '¿Cuál es la contraseña del wifi?' },
    ],
  },
  {
    id: 'pharmacy',
    group: 'When things go wrong',
    title: 'At the pharmacy',
    blurb: 'Saying what hurts, and understanding the answer.',
    turns: [
      ['Pharmacist', 'Good afternoon. How can I help you?'],
      ['You', 'I do not feel well.'],
      ['Pharmacist', 'What is wrong?'],
      ['You', 'I have a headache, and a sore throat.'],
      ['Pharmacist', 'Since when?'],
      ['You', 'Since yesterday night.'],
      ['Pharmacist', 'Do you have a temperature?'],
      ['You', 'A little, I think. Do you have something for the throat?'],
      ['Pharmacist', 'Yes. Take one of these every eight hours, with food.'],
      ['You', 'For how many days?'],
      ['Pharmacist', 'Three or four. If you are not better, go to a doctor.'],
      ['You', 'Understood. Thank you very much.'],
    ],
    phrases: [
      { en: 'I do not feel well.', es: 'No me encuentro bien.' },
      { en: 'What is wrong?', es: '¿Qué le pasa?' },
      { en: 'I have a headache.', es: 'Me duele la cabeza.' },
      { en: 'I have a sore throat.', es: 'Me duele la garganta.' },
      { en: 'Do you have something for the throat?', es: '¿Tiene algo para la garganta?' },
      { en: 'Every eight hours, with food.', es: 'Cada ocho horas, con comida.' },
      { en: 'I need a doctor.', es: 'Necesito un médico.' },
    ],
  },
  {
    id: 'kayak',
    group: 'Out and about',
    title: 'Hiring a kayak',
    blurb: 'Time, gear, and whether the sea is behaving.',
    turns: [
      ['You', 'Good morning. I would like to hire a kayak.'],
      ['Instructor', 'For one person or two?'],
      ['You', 'One. For how long can I take it?'],
      ['Instructor', 'One hour, two hours, or the morning.'],
      ['You', 'Two hours. How much is it?'],
      ['Instructor', 'Eighteen euros. Do you need a life jacket?'],
      ['You', 'Yes, please. Is the sea calm today?'],
      ['Instructor', 'Now yes. In the afternoon the wind comes from the west.'],
      ['You', 'Where can I go?'],
      ['Instructor', 'To the island and back. Do not pass the red buoy.'],
      ['You', 'Understood. And what time do I have to be back?'],
      ['Instructor', 'Before one. Have a good time.'],
    ],
    phrases: [
      { en: 'I would like to hire a kayak.', es: 'Quisiera alquilar un kayak.' },
      { en: 'For how long can I take it?', es: '¿Para cuánto tiempo puedo cogerlo?' },
      { en: 'Do you need a life jacket?', es: '¿Necesita chaleco salvavidas?' },
      { en: 'Is the sea calm today?', es: '¿Está tranquilo el mar hoy?' },
      { en: 'The wind comes from the west.', es: 'El viento viene del oeste.' },
      { en: 'What time do I have to be back?', es: '¿A qué hora tengo que volver?' },
    ],
  },
  {
    id: 'plans',
    group: 'Everyday',
    title: 'Making plans',
    blurb: 'On the phone, and short.',
    turns: [
      ['Elena', 'Hello? Who is it?'],
      ['You', 'Hello Elena, it is Kareem. Do you have a minute?'],
      ['Elena', 'Yes, tell me.'],
      ['You', 'What are you doing this weekend?'],
      ['Elena', 'On Saturday I am working. On Sunday, nothing.'],
      ['You', 'Do you fancy a coffee on Sunday?'],
      ['Elena', 'Yes, good idea. What time suits you?'],
      ['You', 'At eleven, in the square?'],
      ['Elena', 'Better at twelve. At eleven I am still asleep.'],
      ['You', 'At twelve then. See you there.'],
      ['Elena', 'See you Sunday. If there is a problem I will call you.'],
    ],
    phrases: [
      { en: 'Do you have a minute?', es: '¿Tienes un minuto?' },
      { en: 'Tell me.', es: 'Dime.' },
      { en: 'What are you doing this weekend?', es: '¿Qué haces este fin de semana?' },
      { en: 'Do you fancy a coffee?', es: '¿Te apetece un café?' },
      { en: 'What time suits you?', es: '¿A qué hora te viene bien?' },
      { en: 'See you there.', es: 'Nos vemos allí.' },
      { en: 'I will call you.', es: 'Te llamo.' },
    ],
  },
];

/** The dialogue as text the weaver can chew on. */
export function sceneToText(scene) {
  return scene.turns.map(([speaker, line]) => `${speaker}: ${line}`).join('\n\n');
}

/** Scenes grouped for the picker, in the order defined above. */
export function sceneGroups(scenes = SCENES) {
  const groups = new Map();
  for (const scene of scenes) {
    if (!groups.has(scene.group)) groups.set(scene.group, []);
    groups.get(scene.group).push(scene);
  }
  return [...groups].map(([name, items]) => ({ name, scenes: items }));
}

/** Every phrase in the book, for a drill across the lot. */
export function allPhrases(scenes = SCENES) {
  const seen = new Set();
  const out = [];
  for (const scene of scenes) {
    for (const phrase of scene.phrases) {
      const key = phrase.es.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...phrase, scene: scene.title });
    }
  }
  return out;
}
