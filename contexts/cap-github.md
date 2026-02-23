---
name: cap-github
type: capability
---
# GitHub — Setup Guide

Check notifications, PRs, issues via the `gh` CLI.

## Setup
The user needs to authenticate the GitHub CLI:
```bash
gh auth login
```
Follow the prompts to authenticate via browser or token.

## Notes
- No custom tool needed — use `spawn_subagent` with shell commands
- The heartbeat already checks GitHub notifications if configured
- Or tell the user to run: `betterbot setup github`
