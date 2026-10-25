# Telegram taxi request bot

This is a separate implementation in `telegram/`; it does not replace the existing MAX bot.

## Required Render environment variables

- `TELEGRAM_BOT_TOKEN`: token from @BotFather.
- `TELEGRAM_ADMIN_CHAT_ID`: Telegram chat ID of the coordinator who receives confirmed requests.
- `PORT`: provided automatically by Render.

The service uses Telegram Bot API long polling and exposes `/` for a basic health check.

## Current scope

- Collects the fields from the taxi request form using a conversational flow.
- Asks conditional questions about children and access restrictions.
- Shows a summary before confirmation.
- Sends the confirmed request to the coordinator chat.
- Keeps unfinished form state in memory; it is not a durable database.
- Does not book a taxi automatically.

## Deployment

Configure a separate Render Web Service with root directory `telegram`, build command `npm install`, start command `npm start`, and set the environment variables above. Do not deploy this branch to the existing MAX service until a separate service has been reviewed and explicitly chosen.
