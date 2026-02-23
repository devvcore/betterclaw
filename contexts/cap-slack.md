---
name: cap-slack
type: capability
---
# Slack — Setup Guide

Send messages and read channels in Slack via Bot API.

## What You Need
- `slack_bot_token` credential — from a Slack app

## Setup Steps
1. User creates a Slack app at api.slack.com/apps
2. Add OAuth scopes: `chat:write`, `channels:read`, `channels:history`
3. Install app to workspace
4. Copy the Bot User OAuth Token (`xoxb-...`)
5. Store: `store_credential("slack_bot_token", "xoxb-...")`

## Custom Tools to Build
- `send_slack(channel, text)` — POST to `https://slack.com/api/chat.postMessage`
- `read_slack(channel, limit?)` — GET `https://slack.com/api/conversations.history`

Use `get_credential("slack_bot_token")` as Bearer token inside tools.

Or tell the user to run: `betterbot setup slack`
