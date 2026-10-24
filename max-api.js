import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const MAX_API_URL = 'https://platform-api2.max.ru';
const ACCESS_TOKEN = process.env.MAX_BOT_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('MAX_BOT_TOKEN not set in .env');
  process.exit(1);
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const api = axios.create({
  baseURL: MAX_API_URL,
  headers: {
    'Authorization': ACCESS_TOKEN,
    'Content-Type': 'application/json'
  },
  httpsAgent: httpsAgent,
  timeout: 30000
});

export async function sendMessage(chatId, text, keyboard = null) {
  try {
    const payload = { text: text };
    
    if (keyboard) {
      const buttons = keyboard.inline_keyboard || keyboard;
      payload.attachments = [{
        type: 'inline_keyboard',
        payload: { buttons: buttons }
      }];
    }
    
    const response = await api.post('/messages?chat_id=' + chatId, payload);
    console.log('Message sent to chat ' + chatId);
    return response.data;
  } catch (error) {
    console.error('Send error:', error.response?.data || error.message);
    throw error;
  }
}

export async function sendMessageWithButtons(chatId, text, buttons) {
  return sendMessage(chatId, text, { inline_keyboard: buttons });
}

export function createInlineButton(text, callbackData) {
  return {
    type: 'callback',
    text: text,
    payload: callbackData
  };
}

export async function getMe() {
  try {
    const response = await api.get('/me');
    console.log('Bot info received');
    return response.data;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    throw error;
  }
}