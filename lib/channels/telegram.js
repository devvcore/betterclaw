import { Session } from '../session.js';
import { getCredential } from '../credentials.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import config from '../../config.js';

const API_BASE = 'https://api.telegram.org/bot';
const SESSIONS_FILE = join(config.dataDir, 'telegram-sessions.json');
const MAX_MESSAGE_LENGTH = 4096;

// Load chat-to-session mapping
async function loadSessionMap() {
  try {
    const raw = await readFile(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSessionMap(map) {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(map, null, 2));
}

// Telegram API helpers
async function tg(token, method, body = {}) {
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

async function sendMessage(token, chatId, text, opts = {}) {
  // Chunk if too long
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to break at a newline near the limit
    let breakAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (breakAt < MAX_MESSAGE_LENGTH / 2) breakAt = MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }

  for (const chunk of chunks) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: chunk,
      parse_mode: opts.parseMode || undefined,
    });
  }
}

async function sendTyping(token, chatId) {
  try {
    await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch { /* non-critical */ }
}

// Get or create a session for a Telegram chat
async function getSession(chatId, sessionMap) {
  if (sessionMap[chatId]) {
    try {
      return await Session.resume(sessionMap[chatId]);
    } catch { /* session file gone, create new */ }
  }

  const session = new Session();
  await session.init();
  sessionMap[chatId] = session.id;
  await saveSessionMap(sessionMap);
  return session;
}

// Handle a single incoming message
async function handleMessage(token, message, sessionMap, allowedChatIds) {
  const chatId = message.chat.id;
  const text = message.text;

  if (!text) return; // Ignore non-text messages

  // Authorization check
  if (allowedChatIds.length > 0 && !allowedChatIds.includes(String(chatId))) {
    console.log(`Telegram: unauthorized message from chat ${chatId}`);
    await sendMessage(token, chatId, 'Not authorized.');
    return;
  }

  const session = await getSession(String(chatId), sessionMap);

  // Send typing indicator
  await sendTyping(token, chatId);

  // Keep sending typing indicator while processing
  const typingInterval = setInterval(() => sendTyping(token, chatId), 4000);

  try {
    let fullResponse = '';

    for await (const event of session.sendStream(text)) {
      if (event.type === 'text') {
        fullResponse += event.text;
      } else if (event.type === 'tool_start' || event.type === 'tool_result') {
        // Keep typing indicator alive while tools run, but don't send tool details
        await sendTyping(token, chatId);
      }
    }

    // Send the final response
    if (fullResponse.trim()) {
      try {
        await sendMessage(token, chatId, fullResponse.trim(), { parseMode: 'Markdown' });
      } catch {
        // Markdown might fail, send plain
        await sendMessage(token, chatId, fullResponse.trim());
      }
    }
  } catch (err) {
    console.error(`Telegram: error handling message: ${err.message}`);
    await sendMessage(token, chatId, `Error: ${err.message}`);
  } finally {
    clearInterval(typingInterval);
  }
}

export async function startTelegramBot() {
  const token = await getCredential('telegram_bot_token');
  if (!token) throw new Error('telegram_bot_token not configured (run: claw creds set telegram_bot_token <token>)');

  // Load allowed chat IDs from user config
  const userConfig = config.telegram || {};
  const allowedChatIds = (userConfig.allowedChatIds || []).map(String);

  // Verify token
  const me = await tg(token, 'getMe');
  console.log(`Telegram bot: @${me.username}`);

  const sessionMap = await loadSessionMap();
  let offset = 0;
  let running = true;

  // Long polling loop
  const poll = async () => {
    while (running) {
      try {
        const updates = await tg(token, 'getUpdates', {
          offset,
          timeout: 30,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          if (update.message) {
            // Handle messages sequentially to avoid session race conditions
            await handleMessage(token, update.message, sessionMap, allowedChatIds);
          }
        }
      } catch (err) {
        if (!running) break;
        console.error(`Telegram poll error: ${err.message}`);
        // Back off on error
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  };

  // Start polling in background
  poll();

  // Return stop function
  return () => {
    running = false;
  };
}

// Setup: store bot token and verify
export async function setupTelegram() {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  console.log('Telegram Bot Setup');
  console.log('──────────────────');
  console.log('1. Open Telegram and message @BotFather');
  console.log('2. Send /newbot and follow the prompts');
  console.log('3. Copy the bot token\n');

  const token = await ask('Bot token: ');
  if (!token.trim()) {
    console.log('Cancelled.');
    rl.close();
    return;
  }

  // Verify token
  try {
    const me = await tg(token.trim(), 'getMe');
    console.log(`\nBot verified: @${me.username} (${me.first_name})`);
  } catch (err) {
    console.error(`\nInvalid token: ${err.message}`);
    rl.close();
    return;
  }

  // Store in Keychain
  const { setCredential } = await import('../credentials.js');
  await setCredential('telegram_bot_token', token.trim());
  console.log('Token stored in Keychain.');

  // Ask for allowed chat IDs
  console.log('\nTo restrict who can message the bot, send a message to @userinfobot');
  console.log('to get your chat ID, then enter it below (or press Enter to skip).\n');

  const chatIds = await ask('Allowed chat IDs (comma-separated, or Enter to skip): ');
  if (chatIds.trim()) {
    const ids = chatIds.split(',').map(s => s.trim()).filter(Boolean);
    console.log(`\nAdd this to ~/.betterclaw/config.json:`);
    console.log(JSON.stringify({ telegram: { allowedChatIds: ids } }, null, 2));
  }

  rl.close();
  console.log('\nDone! Start the gateway to activate: claw gateway');
}
