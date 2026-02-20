---
name: cap-crons
type: capability
---
# Scheduled Tasks (Crons) — Guide

Run tasks on a schedule via the gateway.

## Tools
- `create_cron(name, schedule, prompt)` — create a recurring task
- `list_crons()` — see all scheduled jobs
- `update_cron(id, ...)` — modify name, schedule, prompt, or enabled state
- `enable_cron(id)` / `disable_cron(id)` — toggle on/off
- `delete_cron(id)` — remove permanently

## Schedule Format
Standard 5-field cron: `minute hour day-of-month month day-of-week`

Examples:
- `0 9 * * 1-5` — weekday mornings at 9 AM
- `0 18 * * 5` — Friday evening at 6 PM
- `*/30 * * * *` — every 30 minutes
- `0 8 * * 1` — Monday at 8 AM

## How It Works
- Gateway checks every 60 seconds for crons that should fire
- Each cron spawns a disposable agent with all tools + today's journal
- The agent has NO memory of past runs — write results to the journal
- Write clear, specific prompts — the cron agent needs full context

## Good Cron Prompts
- "Check email inbox. Summarize any new unread messages in today's journal under Notes."
- "Check GitHub notifications. Log any new PRs or issues to the journal."
- "Review today's journal tasks. Send a Telegram summary of incomplete items."

## Bad Cron Prompts
- "Check stuff" — too vague
- "Continue yesterday's work" — cron agent has no memory
