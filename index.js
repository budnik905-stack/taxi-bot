import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getMe, sendMessage } from './max-api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_API = 'https://platform-api2.max.ru';
const WEBHOOK_URL = 'https://taxi-bot-5w1r.onrender.com/webhook';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'MAX webhook bot is running', timestamp: new Date().toISOString() });
});

app.post('/webhook', async (req, res) => {
  const secret = process.env.MAX_WEBHOOK_SECRET;
  if (!secret || req.get('X-Max-Bot-Api-Secret') !== secret) {
    console.warn('Rejected webhook: invalid secret');
    return res.status(401).json({ ok: false });
  }

  const u = req.body || {};
  const type = u.update_type || 'unknown';
  const chatId = u.chat_id || u.message?.recipient?.chat_id;
  const userId = u.user?.user_id || u.message?.sender?.user_id;
  console.log('MAX event:', type, 'chat_id:', chatId || 'none', 'user_id:', userId || 'none');
  res.status(200).json({ ok: true });

  if (chatId && (type === 'bot_started' || (type === 'message_created' && (u.message?.body?.text || '').trim() === '/start'))) {
    try {
      await sendMessage(chatId, 'Здравствуйте! Этот бот теперь только получает копии заявок, оформленных в Telegram. Заполнять заявку здесь не нужно.');
      console.log('Sent MAX welcome notice to', chatId);
    } catch (e) {
      console.error('MAX welcome message failed:', e.response?.data || e.message);
    }
  }
});

app.listen(PORT, async () => {
  console.log('MAX webhook server listening on', PORT);
  try {
    const me = await getMe();
    console.log('MAX token OK. Bot:', me.name || me.username || 'unknown');
    if (!process.env.MAX_WEBHOOK_SECRET) {
      console.error('MAX_WEBHOOK_SECRET missing; subscription not configured.');
      return;
    }
    const r = await fetch(MAX_API + '/subscriptions', {
      method: 'POST',
      headers: { Authorization: process.env.MAX_BOT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        update_types: ['bot_started', 'message_created', 'bot_stopped'],
        secret: process.env.MAX_WEBHOOK_SECRET
      })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.success === false) {
      console.error('MAX webhook subscription failed:', r.status, body);
    } else {
      console.log('MAX webhook subscription request accepted:', body);
    }
  } catch (e) {
    console.error('MAX startup error:', e.response?.data || e.message);
  }
});
