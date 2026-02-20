---
name: cap-reminders
type: capability
---
# Apple Reminders — Setup Guide

Create and check reminders in Apple Reminders via AppleScript.

## Setup
No API key needed. Build custom tools using AppleScript.

### Create Reminder
```applescript
tell application "Reminders"
  make new reminder in list "Reminders" with properties {name:"Title", due date:date "..."}
end tell
```

### List Incomplete Reminders
```applescript
tell application "Reminders"
  set todoList to reminders in list "Reminders" whose completed is false
end tell
```

## Notes
- macOS may prompt for Reminders access permission on first use
- Or tell the user to run: `claw setup reminders`
