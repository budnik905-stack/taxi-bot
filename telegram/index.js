import express from 'express';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'telegram-taxi-request-bot', configured: Boolean(TOKEN) });
});
app.listen(PORT, () => console.log(`Health server listening on ${PORT}`));

const sessions = new Map();
let offset = 0;
let nextRequestNumber = 1;

const YES_NO = [['Да', 'yes'], ['Нет', 'no']];
const QUESTIONS = [
  { key: 'requester', text: 'Кто оформляет заявку? Укажите имя или фамилию.' },
  { key: 'phone', text: 'Контактный телефон заявителя:' },
  { key: 'passengerDetails', text: 'Приметы пассажира для водителя: одежда, багаж, коляска или другие приспособления. Если особых примет нет, напишите «Нет».' },
  { key: 'pickup', text: 'Полный адрес подачи: город, улица, дом, подъезд и другие важные детали.' },
  { key: 'destination', text: 'Полный адрес назначения: город, улица, дом, подъезд и другие важные детали.' },
  { key: 'when', text: 'Когда нужна машина?', buttons: [['Сейчас', 'now'], ['Позже', 'later']] },
  { key: 'date', text: 'На какую дату нужна машина? Введите ДД.ММ.ГГГГ.', when: d => d.when === 'later' },
  { key: 'time', text: 'К какому времени подать машину? Введите ЧЧ:ММ.', when: d => d.when === 'later' },
  { key: 'passengers', text: 'Сколько всего человек поедет, включая сопровождающих?', buttons: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6 и более', '6+']] },
  { key: 'children', text: 'Будут ли среди пассажиров дети?', buttons: YES_NO },
  { key: 'childrenAges', text: 'Укажите возраст каждого ребёнка. Если детей несколько, перечислите возраст каждого.', when: d => d.children === 'yes' },
  { key: 'childSeat', text: 'Требуется ли детское кресло или бустер?', buttons: YES_NO, when: d => d.children === 'yes' },
  { key: 'escort', text: 'Будет ли с подопечным ехать сопровождающий?', buttons: YES_NO },
  { key: 'boardingHelp', text: 'Нужна ли помощь при посадке или высадке?', buttons: YES_NO },
  { key: 'pickupBarrier', text: 'Есть ли шлагбаум или ограниченный въезд по адресу подачи?', buttons: YES_NO },
  { key: 'pickupBarrierHow', text: 'Что нужно водителю для въезда по адресу подачи? Можно перечислить несколько пунктов текстом.', when: d => d.pickupBarrier === 'yes' },
  { key: 'destinationBarrier', text: 'Есть ли шлагбаум или ограниченный въезд по адресу назначения?', buttons: YES_NO },
  { key: 'destinationBarrierHow', text: 'Что нужно водителю для въезда по адресу назначения?', when: d => d.destinationBarrier === 'yes' },
  { key: 'meetingContact', text: 'Кому позвонить для въезда или встречи? Укажите имя и телефон. Если не требуется, напишите «Не требуется».' },
  { key: 'wait', text: 'Нужно ли водителю ожидать пассажира на месте подачи?', buttons: YES_NO },
  { key: 'waitDuration', text: 'Сколько времени потребуется на ожидание?', buttons: [['До 5 минут', 'До 5 минут'], ['5–10 минут', '5–10 минут'], ['10–20 минут', '10–20 минут'], ['Более 20 минут', 'Более 20 минут']], when: d => d.wait === 'yes' },
  { key: 'payer', text: 'Кто оплачивает поездку?', buttons: [['Сам пассажир', 'Сам пассажир'], ['Организация', 'Организация'], ['Сотрудник или сопровождающий', 'Сотрудник или сопровождающий'], ['Другой человек', 'Другой человек']] },
  { key: 'extra', text: 'Какие ещё обстоятельства нужно учесть? Если дополнительных сведений нет, напишите «Нет».' }
];

function keyboard(rows) {
  return { inline_keyboard: rows.map(row => row.map(([text, value]) => ({
    text, callback_data: value
  }))) };
}

async function telegram(method, body = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram API ${method}: ${data.description || response.status}`);
  return data.result;
}

async function send(chatId, text, reply_markup) {
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  if (reply_markup) body.reply_markup = reply_markup;
  return telegram('sendMessage', body);
}

function getNextQuestion(session) {
  while (session.index < QUESTIONS.length) {
    const q = QUESTIONS[session.index];
    if (!q.when || q.when(session.data)) return q;
    session.index++;
  }
  return null;
}

async function ask(chatId, session) {
  const q = getNextQuestion(session);
  if (!q) return showSummary(chatId, session);
  const rows = q.buttons ? keyboard(q.buttons.map(item => [item])) : undefined;
  await send(chatId, q.text, rows);
}

function prettyWhen(d) {
  return d.when === 'now' ? 'Сейчас' : `${d.date || 'дата не указана'} в ${d.time || 'время не указано'}`;
}

function summary(d, requestNo) {
  const lines = [
    `ЗАЯВКА НА ВЫЗОВ ТАКСИ № ${requestNo}`,
    `Заявитель: ${d.requester}`,
    `Телефон заявителя: ${d.phone}`,
    `Приметы пассажира: ${d.passengerDetails}`,
    `Откуда: ${d.pickup}`,
    `Куда: ${d.destination}`,
    `Подача: ${prettyWhen(d)}`,
    `Пассажиров: ${d.passengers}`,
    `Дети: ${d.children === 'yes' ? 'Да' : 'Нет'}`
  ];
  if (d.children === 'yes') {
    lines.push(`Возраст детей: ${d.childrenAges}`);
    lines.push(`Кресло/бустер: ${d.childSeat === 'yes' ? 'Да' : 'Нет'}`);
  }
  lines.push(
    `Сопровождающий: ${d.escort === 'yes' ? 'Да' : 'Нет'}`,
    `Помощь при посадке/высадке: ${d.boardingHelp === 'yes' ? 'Да' : 'Нет'}`,
    `Ограничения на въезде при подаче: ${d.pickupBarrier === 'yes' ? 'Да' : 'Нет'}`
  );
  if (d.pickupBarrier === 'yes') lines.push(`Въезд при подаче: ${d.pickupBarrierHow}`);
  lines.push(`Ограничения на въезде по адресу назначения: ${d.destinationBarrier === 'yes' ? 'Да' : 'Нет'}`);
  if (d.destinationBarrier === 'yes') lines.push(`Въезд по адресу назначения: ${d.destinationBarrierHow}`);
  lines.push(
    `Контакт для встречи/въезда: ${d.meetingContact}`,
    `Ожидание: ${d.wait === 'yes' ? (d.waitDuration || 'да, длительность не указана') : 'Нет'}`,
    `Оплата: ${d.payer}`,
    `Дополнительные обстоятельства: ${d.extra}`
  );
  return lines.join('\n');
}

async function showSummary(chatId, session) {
  session.requestNo = nextRequestNumber;
  const text = summary(session.data, session.requestNo);
  await send(chatId, `Проверьте заявку перед отправкой:\n\n${text}`, keyboard([
    [['✅ Подтвердить и отправить', 'confirm']],
    [['✏️ Исправить ответ', 'edit_menu']],
    [['🔄 Начать заново', 'restart'], ['❌ Отменить', 'cancel']]
  ]));
  session.awaitingConfirmation = true;
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const userId = message.from?.id;
  const text = (message.text || '').trim();
  if (!chatId || !userId) return;
  if (text === '/id') {
    await send(chatId, `ID этого чата: ${chatId}\\nПередайте этот номер администратору для настройки получения заявок.`);
    return;
  }
  if (text === '/start' || text === '/new') {
    sessions.set(userId, { chatId, index: 0, data: {}, awaitingConfirmation: false });
    await send(chatId, 'Здравствуйте! Я помогу подготовить заявку на такси для Гали. Отвечайте на вопросы по очереди. Заказ автомобиля автоматически не выполняется.');
    await ask(chatId, sessions.get(userId));
    return;
  }
  if (text === '/cancel') {
    sessions.delete(userId);
    await send(chatId, 'Заявка отменена. Чтобы начать заново, отправьте /start.');
    return;
  }
  const session = sessions.get(userId);
  if (!session) {
    await send(chatId, 'Чтобы оформить заявку, отправьте /start.');
    return;
  }
  if (session.awaitingEdit) {
    const key = session.editKey;
    session.data[key] = text;
    session.awaitingEdit = false;
    session.editKey = null;
    session.awaitingConfirmation = false;
    await showSummary(chatId, session);
    return;
  }
  if (session.awaitingConfirmation) {
    await send(chatId, 'Пожалуйста, выберите кнопку под сводкой: подтвердить, исправить ответ, начать заново или отменить.');
    return;
  }
  const q = getNextQuestion(session);
  if (!q) return showSummary(chatId, session);
  if (q.key === 'phone' && !/[0-9+()\-\s]{7,}/.test(text)) {
    await send(chatId, 'Пожалуйста, укажите телефон цифрами; можно использовать +, пробелы, скобки и дефисы.');
    return;
  }
  if (q.key === 'date' && !/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
    await send(chatId, 'Введите дату в формате ДД.ММ.ГГГГ, например 26.10.2026.');
    return;
  }
  if (q.key === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    await send(chatId, 'Введите время в формате ЧЧ:ММ, например 11:00.');
    return;
  }
  session.data[q.key] = text;
  session.index++;
  await ask(chatId, session);
}

async function handleCallback(callback) {
  const userId = callback.from?.id;
  const chatId = callback.message?.chat?.id;
  const data = callback.data;
  if (callback.id) await telegram('answerCallbackQuery', { callback_query_id: callback.id });
  const session = sessions.get(userId);
  if (session?.awaitingEdit && session.editKey) {
    const q = QUESTIONS.find(item => item.key === session.editKey);
    if (q?.buttons && q.buttons.some(([, value]) => value === data)) {
      session.data[session.editKey] = data;
      if (session.editKey === 'when' && data === 'now') { delete session.data.date; delete session.data.time; }
      if (session.editKey === 'children' && data === 'no') { delete session.data.childrenAges; delete session.data.childSeat; }
      if (session.editKey === 'pickupBarrier' && data === 'no') delete session.data.pickupBarrierHow;
      if (session.editKey === 'destinationBarrier' && data === 'no') delete session.data.destinationBarrierHow;
      if (session.editKey === 'wait' && data === 'no') delete session.data.waitDuration;
      session.awaitingEdit = false;
      session.editKey = null;
      await showSummary(chatId, session);
    }
    return;
  }
  if (data === 'edit_menu' && session?.awaitingConfirmation) {
    session.awaitingConfirmation = false;
    const fields = QUESTIONS.filter(q => Object.hasOwn(session.data, q.key) && (!q.when || q.when(session.data)));
    const rows = fields.map(q => [[q.key === 'pickup' ? 'Адрес подачи' : q.key === 'destination' ? 'Адрес назначения' : q.key === 'phone' ? 'Телефон' : q.text.slice(0, 55), `edit_${q.key}`]]);
    await send(chatId, 'Какой ответ исправить?', keyboard([...rows, [['↩️ Назад к сводке', 'back_summary']]]));
    session.editMenu = true;
    return;
  }
  if (data === 'back_summary' && session) {
    session.editMenu = false;
    await showSummary(chatId, session);
    return;
  }
  if (data?.startsWith('edit_') && session?.editMenu) {
    const key = data.slice(5);
    const q = QUESTIONS.find(item => item.key === key);
    if (!q || !Object.hasOwn(session.data, key)) return;
    session.editMenu = false;
    session.editKey = key;
    if (q.buttons) {
      session.awaitingEdit = true;
      await send(chatId, `Выберите новое значение: ${q.text}`, keyboard(q.buttons.map(item => [item])));
    } else {
      session.awaitingEdit = true;
      await send(chatId, `Введите исправленный ответ: ${q.text}`);
    }
    return;
  }
  if (data === 'restart') {
    sessions.set(userId, { chatId, index: 0, data: {}, awaitingConfirmation: false });
    await ask(chatId, sessions.get(userId));
    return;
  }
  if (data === 'cancel') {
    sessions.delete(userId);
    await send(chatId, 'Заявка отменена. Чтобы начать заново, отправьте /start.');
    return;
  }
  if (data === 'confirm' && session?.awaitingConfirmation) {
    const text = summary(session.data, session.requestNo);
    try {
      if (!ADMIN_CHAT_ID) throw new Error('TELEGRAM_ADMIN_CHAT_ID is not configured');
      await send(ADMIN_CHAT_ID, text);
      await send(chatId, `Заявка № ${session.requestNo} отправлена Гале. Это подтверждение заявки, а не автоматический заказ такси.`);
      nextRequestNumber++;
      sessions.delete(userId);
    } catch (err) {
      console.error('Could not deliver confirmed request:', err.message);
      await send(chatId, 'Не удалось отправить заявку получателю. Заявка не потеряна в текущем сеансе. Сообщите администратору о проблеме.');
    }
    return;
  }
  if (!session || session.awaitingConfirmation) return;
  const q = getNextQuestion(session);
  if (!q?.buttons) return;
  const allowed = q.buttons.some(([, value]) => value === data);
  if (!allowed) return;
  session.data[q.key] = data;
  session.index++;
  await ask(chatId, session);
}

async function runBot() {
  console.log('Starting Telegram long polling');
  while (true) {
    try {
      const updates = await telegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not configured; Telegram polling is disabled.');
} else {
  runBot().catch(err => {
    console.error('Telegram bot stopped:', err);
    process.exitCode = 1;
  });
}
