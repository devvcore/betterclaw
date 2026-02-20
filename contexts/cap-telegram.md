---
name: cap-telegram
type: capability
---
# Telegram — Setup Guide

Telegram bot for receiving and sending messages.

## What You Need
- `telegram_bot_token` credential — from @BotFather
- `telegram_chat_id` credential — the user's chat ID
- `send_telegram_raw` custom tool — for proactive messaging

## Setup Steps
1. User creates a bot via @BotFather on Telegram (/newbot command)
2. Store the bot token: `store_credential("telegram_bot_token", "TOKEN")`
3. To detect chat ID: ask user to send ANY message to the bot, then:
   ```
   fetch("https://api.telegram.org/bot{TOKEN}/getUpdates")
   ```
   The chat ID is in `result[0].message.chat.id`
4. Store: `store_credential("telegram_chat_id", "CHAT_ID")`
5. Add chat ID to allowlist in `~/.betterclaw/config.json`:
   ```json
   { "telegram": { "allowedChatIds": ["CHAT_ID"] } }
   ```
6. Or tell the user to run: `claw setup telegram`

## Sending Messages
The `send_telegram_raw` tool fetches credentials internally — just call:
```
send_telegram_raw(message="Your message here")
```
Do NOT pass token or chat_id as parameters.

## Notes
- Gateway must be running for the bot to receive messages (`claw gateway`)
- Only whitelisted chat IDs can interact with the bot
