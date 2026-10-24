import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { startLongPolling } from './bot.js';
import { getMe } from './max-api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Bot is working',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, async () => {
  console.log('Server started on port ' + PORT);
  console.log('Mode: Long Polling');
  console.log('');
  
  try {
    const me = await getMe();
    console.log('Token OK! Bot: ' + (me.name || me.username || 'unknown'));
    console.log('');
    console.log('Open Max -> chat with bot -> /start');
    console.log('');
  } catch (error) {
    console.error('Token error:', error.message);
    console.error('Check .env file');
    console.error('');
  }
  
  startLongPolling();
});