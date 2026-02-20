// Browser sub-agent: text-based ARIA snapshots + ref clicking + incremental diffs
// 10-100x cheaper than screenshot+vision approach — no vision model needed
// Uses any text model (even small/cheap ones work great with structured ARIA snapshots)

import { Browser } from './browser.js';
import { computeDiff } from './browser/snapshot-differ.js';
import { createProvider } from './provider.js';

const MAX_STEPS = 25;

// Browser tools — ref-based interaction instead of pixel coordinates
const BROWSER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a URL',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an element by its ref ID (e.g. "e5"). Use the ref shown in [ref=eXX] tags in the snapshot.',
      parameters: { type: 'object', properties: { ref: { type: 'string', description: 'Element ref like "e5"' } }, required: ['ref'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill',
      description: 'Type text into an input/textbox by its ref ID. Clears existing content first.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref like "e3"' },
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['ref', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a special key (Enter, Tab, Escape, Backspace)',
      parameters: { type: 'object', properties: { key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'Backspace'] } }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page. Use "down" or "up".',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_text',
      description: 'Extract all visible text from the current page (useful for reading articles, getting full content)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Task is complete. Return the result.',
      parameters: { type: 'object', properties: { result: { type: 'string', description: 'Summary of what was found or accomplished' } }, required: ['result'] },
    },
  },
];

async function executeBrowserTool(browser, name, args) {
  switch (name) {
    case 'navigate': return await browser.navigate(args.url);
    case 'click': return await browser.clickRef(args.ref);
    case 'fill': return await browser.fillRef(args.ref, args.text);
    case 'press_key': return await browser.pressKey(args.key);
    case 'scroll': {
      const dy = args.direction === 'up' ? -400 : 400;
      return await browser.scroll(640, 450, 0, dy);
    }
    case 'extract_text': {
      const text = await browser.extractText();
      return text.slice(0, 8000);
    }
    case 'done': return null;
    default: return `Unknown action: ${name}`;
  }
}

/**
 * Run a browser task with a text-based sub-agent using ARIA snapshots.
 * @param {string} url - Starting URL
 * @param {string} task - What to do
 * @param {object} opts - Browser options (headless, useProfile)
 * @returns {string} Result summary
 */
export async function runBrowserTask(url, task, opts = {}) {
  let browser;
  try {
    let provider;
    try {
      provider = createProvider('browser');
    } catch {
      provider = createProvider('quick');
    }

    browser = new Browser();
    await browser.launch(opts);
    await browser.navigate(url);

    // Get initial ARIA snapshot
    let prevSnapshot = null;
    let prevUrl = null;
    let snapshot = await browser.getSnapshot();
    let currentUrl = await browser.getURL();

    // Cost tracking
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let modelCalls = 0;

    function costSummary() {
      // Gemini Flash Lite: $0.10/1M input, $0.40/1M output
      // Generic fallback estimate for other models
      const inputCost = (totalInputTokens / 1_000_000) * 0.10;
      const outputCost = (totalOutputTokens / 1_000_000) * 0.40;
      const total = inputCost + outputCost;
      return `\n\n--- Browser Session Cost ---\n${modelCalls} model calls | ${totalInputTokens.toLocaleString()} input + ${totalOutputTokens.toLocaleString()} output tokens | ~$${total.toFixed(4)}`;
    }

    const messages = [
      {
        role: 'system',
        content: `You are a browser automation agent. You interact with web pages using ARIA accessibility snapshots.

Your task: ${task}

## How it works
- You see a text representation of the page (ARIA snapshot) — NOT a screenshot
- Interactive elements have [ref=eXX] tags — use these refs to click or fill
- After each action, you'll see what changed (a diff) or a new full snapshot

## Rules
- Click elements using their ref: click(ref="e5")
- Fill inputs using their ref: fill(ref="e3", text="search query")
- The snapshot shows the page structure: roles, names, and refs
- When you've completed the task, call done(result="...")
- Be efficient — minimize steps
- If an action doesn't change anything, try a different approach
- NEVER hallucinate content — only report what you see in the snapshot
- For SPAs, content may take a moment to render — try scrolling if page seems empty`,
      },
      {
        role: 'user',
        content: `URL: ${currentUrl}\n\nPage snapshot:\n${snapshot}`,
      },
    ];

    const actionHistory = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await provider.chat(messages, {
        tools: BROWSER_TOOLS,
        maxTokens: 1024,
      });

      // Track usage
      if (response.usage) {
        totalInputTokens += response.usage.input || 0;
        totalOutputTokens += response.usage.output || 0;
      }
      modelCalls++;

      const toolCalls = response.toolCalls || response.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          if (call.name === 'done') {
            await browser.close();
            return call.arguments.result + costSummary();
          }

          let result;
          try {
            result = await executeBrowserTool(browser, call.name, call.arguments);
          } catch (err) {
            result = `Error: ${err.message}`;
          }

          // Record action
          const histEntry = {
            action: call.name,
            ref: call.arguments.ref || null,
            text: call.arguments.text || call.arguments.url || null,
            result: typeof result === 'string' ? result.slice(0, 100) : 'ok',
          };
          actionHistory.push(histEntry);

          // Log step to console for visibility
          const refStr = histEntry.ref ? ` ref=${histEntry.ref}` : '';
          const textStr = histEntry.text ? ` "${histEntry.text.slice(0, 40)}"` : '';
          console.log(`  [step ${step + 1}] ${call.name}${refStr}${textStr} → ${histEntry.result}`);

          // Get new snapshot and compute diff
          prevSnapshot = snapshot;
          prevUrl = currentUrl;

          // Small delay for page to update after action
          await new Promise(r => setTimeout(r, 300));

          snapshot = await browser.getSnapshot();
          currentUrl = await browser.getURL();

          // Compute incremental diff
          const diff = computeDiff(prevSnapshot, snapshot, prevUrl, currentUrl);

          // Build the observation message
          let observation;
          if (diff.isEmpty) {
            observation = `Action: ${result}\nNo visible changes on the page.`;
          } else if (diff.isLargeDiff) {
            // Page changed a lot (navigation) — send full snapshot
            observation = `Action: ${result}\nURL: ${currentUrl}\n\nNew page snapshot:\n${snapshot}`;
          } else {
            // Incremental diff — much smaller than full snapshot
            observation = `Action: ${result}\n\nChanges:\n${diff.diff}`;
          }

          messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: [{
              id: call.id || `call_${step}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            }],
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id || `call_${step}`,
            content: observation,
          });
        }
      } else {
        // Model responded with text — done thinking
        await browser.close();
        return (response.content || 'Browser task completed (no explicit result).') + costSummary();
      }
    }

    await browser.close();
    return 'Browser task hit step limit. Partial results may be available.' + costSummary();
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}
