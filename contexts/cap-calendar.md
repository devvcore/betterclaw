---
name: cap-calendar
type: capability
---
# Apple Calendar — Setup Guide

Read and create events in Apple Calendar via AppleScript.

## Setup
No API key needed. Build custom tools using AppleScript via `child_process.execSync("osascript -e '...'")`.

### Read Events Tool
Query Calendar app for events on a given date:
```applescript
tell application "Calendar"
  set targetDate to date "YYYY-MM-DD"
  -- get events from calendar "CalendarName" where start date >= targetDate
end tell
```

### Create Event Tool
```applescript
tell application "Calendar"
  tell calendar "CalendarName"
    make new event with properties {summary:"Title", start date:date "...", end date:date "..."}
  end tell
end tell
```

## Notes
- Detect available calendars first with a `get_calendar_names` helper
- Ask the user which calendar to use as primary, or default to the first one
- macOS may prompt for Calendar access permission on first use
- Or tell the user to run: `claw setup calendar`
