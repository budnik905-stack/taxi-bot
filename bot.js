import { sendMessage, sendMessageWithButtons, createInlineButton } from './max-api.js';
import axios from 'axios';
import https from 'https';

const userStates = new Map();
let marker = null;

const STEPS = ['pickup','destination','intermediate','carClass','passengers','orderTime','scheduledTime','payment','options','childSeat','roundTrip','returnTime','name','phone','comment','receipt','promo','confirm'];

const BOT_QUESTIONS = {
  pickup: '📍 Укажите адрес подачи такси:',
  destination: '📍 Куда поедем? Укажите адрес назначения:',
  intermediate: '🔀 Нужны промежуточные адреса? (введите адрес или "пропустить")',
  carClass: '🚗 Выберите класс автомобиля:',
  passengers: '👥 Сколько пассажиров? (1-7)',
  orderTime: '⏰ Когда нужно подать машину?',
  scheduledTime: '📅 Укажите дату и время (ДД.ММ.ГГГГ ЧЧ:ММ):',
  payment: '💳 Выберите способ оплаты:',
  options: '⚙️ Доп. опции (номера через запятую или "пропустить"):\n\n1. 👶 Детское кресло\n2. ❄️ Кондиционер\n3. 🤫 Тихая поездка\n4. 🧳 Большой багажник\n5. 🐕 Можно с животными\n6. 💪 Помощь с багажом',
  childSeat: '👶 Какое детское кресло нужно?',
  roundTrip: '🔄 Нужна поездка туда и обратно?',
  returnTime: '⏰ Во сколько обратная поездка? (ЧЧ:ММ)',
  name: '👤 Ваше имя:',
  phone: '📱 Контактный телефон:',
  comment: '💬 Комментарий для водителя (или "пропустить"):',
  receipt: '🧾 Нужен ли вам чек?',
  promo: '🎁 Есть промокод? (или "пропустить")',
  confirm: '✅ Проверьте данные и подтвердите заказ:'
};

const CAR_CLASSES = [
  { id: 'Эконом', name: 'Эконом', price: 'от 199₽' },
  { id: 'Комфорт', name: 'Комфорт', price: 'от 299₽' },
  { id: 'Комфорт+', name: 'Комфорт+', price: 'от 399₽' },
  { id: 'Бизнес', name: 'Бизнес', price: 'от 599₽' },
  { id: 'Минивэн', name: 'Минивэн', price: 'от 499₽' },
  { id: 'Детский', name: 'Детский', price: 'от 349₽' }
];

const PAYMENT_METHODS = [
  { id: 'Банковская карта', name: '💳 Банковская карта' },
  { id: 'Наличные', name: '💵 Наличные' },
  { id: 'СБП', name: '🏦 СБП' },
  { id: 'Корпоративный', name: '🏢 Корпоративный' }
];

const CHILD_SEATS = [
  { id: 'Для младенцев (0-1 год)', name: '👶 Для младенцев (0-1 год)' },
  { id: 'Для малышей (1-4 года)', name: '🧒 Для малышей (1-4 года)' },
  { id: 'Для детей (4-7 лет)', name: '👦 Для детей (4-7 лет)' },
  { id: 'Бустер (от 7 лет)', name: '🪑 Бустер (от 7 лет)' }
];

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getUpdates() {
  const params = { limit: 10, timeout: 5 };
  if (marker) params.marker = marker;
  
  const response = await axios.get('https://platform-api2.max.ru/updates', {
    headers: { 'Authorization': process.env.MAX_BOT_TOKEN, 'Content-Type': 'application/json' },
    params: params,
    timeout: 10000,
    httpsAgent: httpsAgent
  });
  
  if (response.data.marker) marker = response.data.marker;
  return response.data.updates || [];
}

async function handleUpdate(update) {
  console.log('📨 Update:', update.update_type);
  
  let chatId, userId, text, data;
  
  if (update.update_type === 'bot_started') {
    chatId = update.chat_id;
    userId = update.user?.user_id || chatId;
  }
  
  if (update.update_type === 'message_created') {
    chatId = update.message?.recipient?.chat_id;
    userId = update.message?.sender?.user_id || chatId;
    text = update.message?.body?.text || '';
  }
  
  if (update.update_type === 'message_callback') {
    chatId = update.message?.recipient?.chat_id || update.chat_id;
    userId = update.callback?.user?.user_id || update.user?.user_id || chatId;
    data = update.callback?.payload || '';
  }
  
  if (!chatId) {
    console.log('⚠️ Нет chat_id, пропускаем');
    return;
  }
  
  console.log('💬 Chat:', chatId, 'User:', userId, 'Text:', text || data);
  
  try {
    if (update.update_type === 'bot_started') {
      console.log('🚀 Bot started by user:', userId);
      await startOrder(chatId, userId);
      return;
    }
    
    if (update.update_type === 'message_created') {
      const text = update.message?.body?.text || '';
      console.log('💬 Message:', text);
      
      if (text === '/start') {
        await startOrder(chatId, userId);
      } else {
        await processMessage(chatId, userId, text);
      }
      return;
    }
    
    if (update.update_type === 'message_callback') {
      const data = update.callback?.payload || update.payload || '';
      console.log('🔘 Callback:', data);
      await processCallback(chatId, userId, data);
      return;
    }
  } catch (error) {
    console.error('❌ Handle error:', error.message);
  }
}

async function processMessage(chatId, userId, text) {
  let state = userStates.get(userId);
  if (!state) {
    await sendMessage(chatId, 'Здравствуйте! 👋 Я бот-помощник для заказа такси.\n\nОтправьте /start чтобы оформить заказ.');
    return;
  }
  await processStep(chatId, userId, state, text);
}

async function startOrder(chatId, userId) {
  console.log('🚀 Starting order for user:', userId);
  
  const initialState = {
    stepIndex: 0,
    orderData: {
      intermediateAddresses: [],
      options: [],
      passengersCount: 1,
      orderTime: 'now',
      paymentMethod: 'card',
      roundTrip: false,
      needReceipt: false
    }
  };
  
  userStates.set(userId, initialState);
  
  await sendMessage(chatId, 'Здравствуйте! 👋 Я бот-помощник для заказа такси. Помогу вам быстро и удобно оформить поездку. Начнём? 🚕');
  await askQuestion(chatId, userId, initialState);
}

async function askQuestion(chatId, userId, state) {
  const step = STEPS[state.stepIndex];
  
  if (!step) {
    await sendMessage(chatId, '✅ Заказ оформлен! Спасибо за использование нашего сервиса.');
    userStates.delete(userId);
    return;
  }
  
  if (step === 'scheduledTime' && state.orderData.orderTime === 'now') {
    state.stepIndex++;
    await askQuestion(chatId, userId, state);
    return;
  }
  if (step === 'childSeat' && !state.orderData.options.includes('child_seat')) {
    state.stepIndex++;
    await askQuestion(chatId, userId, state);
    return;
  }
  if (step === 'returnTime' && !state.orderData.roundTrip) {
    state.stepIndex++;
    await askQuestion(chatId, userId, state);
    return;
  }
  
  switch (step) {
    case 'carClass':
      await sendMessageWithButtons(chatId, BOT_QUESTIONS.carClass, CAR_CLASSES.map(c => [createInlineButton(c.name + ' - ' + c.price, c.id)]));
      break;
    case 'payment':
      await sendMessageWithButtons(chatId, BOT_QUESTIONS.payment, PAYMENT_METHODS.map(p => [createInlineButton(p.name, p.id)]));
      break;
    case 'options':
      await sendMessage(chatId, BOT_QUESTIONS.options);
      break;
    case 'childSeat':
      await sendMessageWithButtons(chatId, BOT_QUESTIONS.childSeat, CHILD_SEATS.map(s => [createInlineButton(s.name, s.id)]));
      break;
    case 'orderTime':
      await sendMessageWithButtons(chatId, BOT_QUESTIONS.orderTime, [[createInlineButton('⚡ Сейчас', 'now')],[createInlineButton('📅 Ко времени', 'scheduled')]]);
      break;
    case 'roundTrip':
      await sendMessageWithButtons(chatId, BOT_QUESTIONS.roundTrip, [[createInlineButton('🔄 Да, туда и обратно', 'yes')],[createInlineButton('➡️ Только в одну сторону', 'no')]]);
      break;
    case 'receipt':
      await sendMessageWithButtons(chatId, BOT_QUESTIONS.receipt, [[createInlineButton('🧾 Да, нужен чек', 'yes')],[createInlineButton('❌ Не нужен', 'no')]]);
      break;
    case 'confirm':
      await sendConfirmation(chatId, state);
      break;
    default:
      await sendMessage(chatId, BOT_QUESTIONS[step]);
  }
}

async function processStep(chatId, userId, state, text) {
  const step = STEPS[state.stepIndex];
  
  if ((text.toLowerCase() === 'пропустить' || text.toLowerCase() === 'skip') && ['intermediate', 'comment', 'promo'].includes(step)) {
    state.stepIndex++;
    await askQuestion(chatId, userId, state);
    return;
  }
  
  switch (step) {
    case 'pickup': state.orderData.pickupAddress = text; state.stepIndex++; break;
    case 'destination': state.orderData.destinationAddress = text; state.stepIndex++; break;
    case 'intermediate':
      if (text.toLowerCase() !== 'пропустить') {
        state.orderData.intermediateAddresses.push(text);
        await sendMessage(chatId, '✅ Адрес добавлен. Введите ещё один или "пропустить"');
        return;
      }
      state.stepIndex++;
      break;
    case 'passengers':
      const count = parseInt(text);
      if (count >= 1 && count <= 7) {
        state.orderData.passengersCount = count;
        state.stepIndex++;
      } else {
        await sendMessage(chatId, '❌ Введите число от 1 до 7');
        return;
      }
      break;
    case 'scheduledTime': state.orderData.scheduledTime = text; state.stepIndex++; break;
    case 'options':
      if (text.toLowerCase() !== 'пропустить') {
        const selected = text.split(',').map(s => s.trim());
        const optionsMap = ['child_seat', 'conditioner', 'quiet_ride', 'large_trunk', 'pet_friendly', 'help_luggage'];
        state.orderData.options = selected.map(n => optionsMap[parseInt(n) - 1]).filter(Boolean);
      }
      state.stepIndex++;
      break;
    case 'returnTime': state.orderData.returnTime = text; state.stepIndex++; break;
    case 'name': state.orderData.passengerName = text; state.stepIndex++; break;
    case 'phone': state.orderData.passengerPhone = text; state.stepIndex++; break;
    case 'comment':
      if (text.toLowerCase() !== 'пропустить') state.orderData.comment = text;
      state.stepIndex++;
      break;
    case 'promo':
      if (text.toLowerCase() !== 'пропустить') state.orderData.promoCode = text;
      state.stepIndex++;
      break;
    default: return;
  }
  
  await askQuestion(chatId, userId, state);
}

async function processCallback(chatId, userId, data) {
  const state = userStates.get(userId);
  if (!state) return;
  
  const step = STEPS[state.stepIndex];
  
  switch (step) {
    case 'carClass': state.orderData.carClass = data; state.stepIndex++; break;
    case 'payment': state.orderData.paymentMethod = data; state.stepIndex++; break;
    case 'orderTime': state.orderData.orderTime = data; state.stepIndex++; break;
    case 'roundTrip': state.orderData.roundTrip = data === 'yes'; state.stepIndex++; break;
    case 'receipt': state.orderData.needReceipt = data === 'yes'; state.stepIndex++; break;
    case 'childSeat': state.orderData.childSeatType = data; state.stepIndex++; break;
    case 'confirm':
      if (data === 'confirm') {
        await finalizeOrder(chatId, userId, state);
        return;
      }
      break;
  }
  
  await askQuestion(chatId, userId, state);
}

async function sendConfirmation(chatId, state) {
  const d = state.orderData;
  let text = '📋 Проверьте данные заказа:\n\n';
  text += '📍 Откуда: ' + d.pickupAddress + '\n';
  text += '📍 Куда: ' + d.destinationAddress + '\n';
  if (d.intermediateAddresses.length > 0) text += '🔀 Через: ' + d.intermediateAddresses.join(', ') + '\n';
  text += '\n🚗 Класс: ' + d.carClass + '\n';
  text += '👥 Пассажиры: ' + d.passengersCount + ' чел.\n';
  text += '⏰ Подача: ' + (d.orderTime === 'now' ? 'Сейчас' : d.scheduledTime) + '\n';
  text += '💳 Оплата: ' + d.paymentMethod + '\n';
  if (d.roundTrip) text += '🔄 Обратно: в ' + d.returnTime + '\n';
  if (d.options.length > 0) text += '\n⚙️ Опции: ' + d.options.join(', ') + '\n';
  text += '\n👤 Имя: ' + d.passengerName + '\n';
  text += '📱 Телефон: ' + d.passengerPhone + '\n';
  if (d.comment) text += '💬 Комментарий: ' + d.comment + '\n';
  text += '\n✅ Подтвердить заказ?';
  
  await sendMessageWithButtons(chatId, text, [[createInlineButton('✅ Подтвердить', 'confirm')],[createInlineButton('❌ Отмена', 'cancel')]]);
}

async function finalizeOrder(chatId, userId, state) {
  const d = state.orderData;
  const orderId = 'TX-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  
  await sendMessage(chatId, '🎉 Заказ успешно оформлен!\n\n📋 Номер заказа: ' + orderId + '\n📍 Маршрут: ' + d.pickupAddress + ' → ' + d.destinationAddress + '\n🚗 Класс: ' + d.carClass + '\n⏰ Подача: ' + (d.orderTime === 'now' ? 'Сейчас' : d.scheduledTime) + '\n\nОжидайте назначения водителя...');
  
  userStates.delete(userId);
}

export async function startLongPolling() {
  console.log('🔄 Long Polling started...');
  
  while (true) {
    try {
      const updates = await getUpdates();
      if (updates && updates.length > 0) {
        for (const update of updates) {
          await handleUpdate(update);
        }
      }
    } catch (error) {
      console.error('❌ Long Polling error:', error.message);
    }
    await sleep(1000);
  }
}