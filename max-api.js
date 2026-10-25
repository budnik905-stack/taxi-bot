import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Use the bundled Russian Trusted Root CA instead of disabling TLS verification.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

const MAX_API_URL = 'https://platform-api2.max.ru';
const ACCESS_TOKEN = process.env.MAX_BOT_TOKEN;

if (!ACCESS_TOKEN) {
  throw new Error('MAX_BOT_TOKEN is not set');
}

const api = axios.create({
  baseURL: MAX_API_URL,
  headers: {
    Authorization: ACCESS_TOKEN,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

export async function sendMessage(chatId, text, keyboard = null) {
  try {
    const payload = { text };
    if (keyboard) {
      const buttons = keyboard.inline_keyboard || keyboard;
      payload.attachments = [{ type: 'inline_keyboard', payload: { buttons } }];
    }
    const response = await api.post('/messages?chat_id=' + encodeURIComponent(chatId), payload);
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
  return { type: 'callback', text, payload: callbackData };
}

export async function getMe() {
  const response = await api.get('/me');
  console.log('MAX API connection verified');
  return response.data;
}
