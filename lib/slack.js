import { getCredential } from './credentials.js';

// In-memory cache for user ID → display name
const userNameCache = new Map();

/**
 * Call a Slack Web API method.
 */
async function slackAPI(method, params = {}) {
  const token = await getCredential('slack_bot_token');
  if (!token) throw new Error('Slack not configured. Store a bot token with store_credential("slack_bot_token", "xoxb-...")');
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
  return data;
}

/**
 * Resolve a Slack user ID to a display name. Cached in-memory.
 */
export async function getUserName(userId) {
  if (userNameCache.has(userId)) return userNameCache.get(userId);
  try {
    const data = await slackAPI('users.info', { user: userId });
    const name = data.user.profile?.display_name || data.user.real_name || data.user.name;
    userNameCache.set(userId, name);
    return name;
  } catch {
    return userId; // fallback to raw ID
  }
}

/**
 * Resolve a channel name (without #) to its ID.
 */
async function resolveChannel(channel) {
  // Already an ID (starts with C, D, or G)
  if (/^[CDG][A-Z0-9]+$/.test(channel)) return channel;

  // Search by name
  const name = channel.replace(/^#/, '');
  let cursor;
  do {
    const params = { types: 'public_channel,private_channel', limit: 200 };
    if (cursor) params.cursor = cursor;
    const data = await slackAPI('conversations.list', params);
    const match = data.channels.find(c => c.name === name);
    if (match) return match.id;
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  throw new Error(`Channel "${channel}" not found. Use slack_list_channels to see available channels.`);
}

/**
 * List channels the bot can see (public + private it's been added to).
 */
export async function listChannels() {
  const channels = [];
  let cursor;
  do {
    const params = { types: 'public_channel,private_channel', limit: 200 };
    if (cursor) params.cursor = cursor;
    const data = await slackAPI('conversations.list', params);
    for (const ch of data.channels) {
      channels.push({
        id: ch.id,
        name: ch.name,
        topic: ch.topic?.value || '',
        memberCount: ch.num_members || 0,
      });
    }
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);
  return channels;
}

/**
 * Silently join a channel. No-ops if already a member or if scope is missing.
 */
async function ensureJoined(channelId) {
  try {
    await slackAPI('conversations.join', { channel: channelId });
  } catch {
    // missing_scope or already_in_channel — either way, continue
  }
}

/**
 * Join all public channels the bot can see. Call on startup so reads never fail.
 */
export async function joinAllChannels() {
  const channels = await listChannels();
  let joined = 0;
  for (const ch of channels) {
    try {
      await slackAPI('conversations.join', { channel: ch.id });
      joined++;
    } catch {
      // skip — private channels can't be self-joined
    }
  }
  return joined;
}

/**
 * Read recent messages from a channel.
 * @param {string} channel - Channel name or ID
 * @param {number} limit - Max messages (default 20)
 */
export async function readChannel(channel, limit = 20) {
  const channelId = await resolveChannel(channel);
  // Auto-join before reading so we never get not_in_channel
  await ensureJoined(channelId);
  const data = await slackAPI('conversations.history', { channel: channelId, limit });
  const messages = [];
  for (const msg of data.messages.reverse()) {
    const name = msg.user ? await getUserName(msg.user) : (msg.username || 'bot');
    const ts = new Date(parseFloat(msg.ts) * 1000);
    const time = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    messages.push(`[${time}] ${name}: ${msg.text}`);
  }
  return messages.join('\n');
}

/**
 * Send a message to a channel.
 * @param {string} channel - Channel name or ID
 * @param {string} text - Message text (supports Slack mrkdwn)
 */
export async function sendMessage(channel, text) {
  const channelId = await resolveChannel(channel);
  await ensureJoined(channelId);
  const data = await slackAPI('chat.postMessage', { channel: channelId, text });
  return { channel: channelId, ts: data.ts };
}
