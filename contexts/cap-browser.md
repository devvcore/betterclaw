---
name: cap-browser
type: capability
---

# Browser Capability

Gives the agent the ability to browse the web, interact with pages, and extract content using ARIA accessibility snapshots — no vision model or screenshots needed.

## Requirements

- **Chrome/Chromium** installed (checked automatically)
- No API keys needed beyond your existing model provider
- No npm dependencies — uses Chrome DevTools Protocol directly

## How it works

The `browse_web(url, task)` tool:
1. Launches Chrome (headed or headless)
2. Reads the page as an ARIA accessibility snapshot (structured text tree)
3. Optimizes the snapshot (strips chrome, dedup, compress — 60-80% token reduction)
4. A text-based sub-agent decides what to do: click by ref, fill inputs, scroll, navigate
5. After each action, computes an incremental diff (only what changed)
6. Returns a text summary when done

## Why ARIA snapshots?

- **10-100x cheaper** than screenshots — no vision model, pure text
- **More reliable** — refs target exact DOM elements, not pixel coordinates
- **Faster** — smaller payloads, faster model responses
- **Works with any text model** — even small/cheap ones

## Model

Uses the `browser` model role from config. Any text model works (no vision needed).

Override in `~/.betterclaw/config.json`:
```json
{
  "models": {
    "browser": { "provider": "openrouter", "model": "google/gemini-2.0-flash-lite-001" }
  }
}
```

## Configuration

In `~/.betterclaw/config.json`:
```json
{
  "browser": {
    "headless": false,
    "useProfile": true
  }
}
```

- `headless: false` — show the browser window (useful for debugging)
- `useProfile: true` — copy Chrome cookies so authenticated sites work (Twitter, GitHub, etc.)

## Setup

Chrome is usually already installed. To verify:

```bash
claw setup browser
```

## Usage examples

```
browse_web("https://example.com", "Extract the main article text")
browse_web("https://github.com/user/repo/issues", "List open issues with their labels")
browse_web("https://x.com", "What are the top trending topics?")
```

## Cost

Each browser session uses the `browser` model with text only:
- At Gemini Flash Lite pricing: ~$0.10/1M input, $0.40/1M output
- A typical 5-step session: ~$0.001 (vs ~$0.005 with screenshots)
- Incremental diffs reduce tokens further on multi-step tasks
