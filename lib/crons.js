import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Session } from './session.js';
import { getDailySoFar, appendEntry } from './journal.js';
import config from '../config.js';

const CRONS_FILE = join(config.dataDir, 'crons.json');

// ══════════════════════════════════════════════════════════
// Storage
// ══════════════════════════════════════════════════════════

async function loadCrons() {
  try {
    return JSON.parse(await readFile(CRONS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

async function saveCrons(crons) {
  if (!existsSync(config.dataDir)) {
    await mkdir(config.dataDir, { recursive: true });
  }
  await writeFile(CRONS_FILE, JSON.stringify(crons, null, 2), 'utf-8');
}

// ══════════════════════════════════════════════════════════
// Cron expression parser (5-field: min hour dom month dow)
// Supports: numbers, *, */N, ranges (1-5), lists (1,3,5)
// ══════════════════════════════════════════════════════════

function parseField(field, min, max) {
  if (field === '*') {
    return null; // matches all
  }

  const values = new Set();

  for (const part of field.split(',')) {
    // */N — step
    if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2));
      if (isNaN(step) || step < 1) throw new Error(`Invalid step: ${part}`);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }

    // N-M — range
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (isNaN(a) || isNaN(b)) throw new Error(`Invalid range: ${part}`);
      for (let i = a; i <= b; i++) values.add(i);
      continue;
    }

    // N — literal
    const n = parseInt(part);
    if (isNaN(n)) throw new Error(`Invalid value: ${part}`);
    values.add(n);
  }

  return values;
}

function parseCronExpression(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields (min hour dom month dow), got ${parts.length}: "${expr}"`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0=Sunday
  };
}

function matchesCron(parsed, date) {
  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  if (parsed.minute && !parsed.minute.has(min)) return false;
  if (parsed.hour && !parsed.hour.has(hour)) return false;
  if (parsed.dayOfMonth && !parsed.dayOfMonth.has(dom)) return false;
  if (parsed.month && !parsed.month.has(month)) return false;
  if (parsed.dayOfWeek && !parsed.dayOfWeek.has(dow)) return false;

  return true;
}

// Validate a cron expression — returns true or throws
export function validateCron(schedule) {
  parseCronExpression(schedule);
  return true;
}

// Human-readable description of a cron schedule
export function describeCron(schedule) {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;

  const [min, hour, dom, month, dow] = parts;
  const pieces = [];

  if (min !== '*' && hour !== '*') {
    const h = parseInt(hour);
    const m = parseInt(min);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    pieces.push(`at ${h12}:${String(m).padStart(2, '0')} ${ampm}`);
  } else if (min.startsWith('*/')) {
    pieces.push(`every ${min.slice(2)} minutes`);
  } else if (hour.startsWith('*/')) {
    pieces.push(`every ${hour.slice(2)} hours`);
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (dow !== '*') {
    const days = dow.split(',').map(d => dayNames[parseInt(d)] || d);
    pieces.push(`on ${days.join(', ')}`);
  }
  if (dom !== '*') {
    pieces.push(`on day ${dom} of the month`);
  }

  return pieces.join(' ') || schedule;
}

// ══════════════════════════════════════════════════════════
// CRUD operations
// ══════════════════════════════════════════════════════════

export async function createCron({ name, schedule, prompt, enabled = true }) {
  validateCron(schedule);

  const crons = await loadCrons();
  const cron = {
    id: randomUUID().slice(0, 8),
    name,
    schedule,
    prompt,
    enabled,
    createdAt: new Date().toISOString(),
    lastRun: null,
    runCount: 0,
    lastResult: null,
  };

  crons.push(cron);
  await saveCrons(crons);
  return cron;
}

export async function listCronJobs() {
  return await loadCrons();
}

export async function getCron(id) {
  const crons = await loadCrons();
  return crons.find(c => c.id === id);
}

export async function updateCron(id, updates) {
  const crons = await loadCrons();
  const idx = crons.findIndex(c => c.id === id);
  if (idx === -1) return null;

  // Validate new schedule if provided
  if (updates.schedule) {
    validateCron(updates.schedule);
  }

  const allowed = ['name', 'schedule', 'prompt', 'enabled'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      crons[idx][key] = updates[key];
    }
  }

  await saveCrons(crons);
  return crons[idx];
}

export async function enableCron(id) {
  return updateCron(id, { enabled: true });
}

export async function disableCron(id) {
  return updateCron(id, { enabled: false });
}

export async function deleteCron(id) {
  const crons = await loadCrons();
  const idx = crons.findIndex(c => c.id === id);
  if (idx === -1) return false;
  crons.splice(idx, 1);
  await saveCrons(crons);
  return true;
}

// ══════════════════════════════════════════════════════════
// Cron runner — called every 60s from the gateway
// Spawns a disposable session (like heartbeat tier 2) for each
// ══════════════════════════════════════════════════════════

export async function runCronTick() {
  const now = new Date();
  const crons = await loadCrons();
  const results = [];

  for (const cron of crons) {
    if (!cron.enabled) continue;

    // Skip if already ran this minute
    if (cron.lastRun) {
      const lastRun = new Date(cron.lastRun);
      if (lastRun.getFullYear() === now.getFullYear() &&
          lastRun.getMonth() === now.getMonth() &&
          lastRun.getDate() === now.getDate() &&
          lastRun.getHours() === now.getHours() &&
          lastRun.getMinutes() === now.getMinutes()) {
        continue;
      }
    }

    let parsed;
    try {
      parsed = parseCronExpression(cron.schedule);
    } catch {
      continue;
    }

    if (!matchesCron(parsed, now)) continue;

    // This cron should fire!
    console.log(`  Cron firing: "${cron.name}" (${cron.schedule})`);

    try {
      const result = await executeCronJob(cron, now);
      results.push({ id: cron.id, name: cron.name, status: 'ok', result });

      // Update cron state
      cron.lastRun = now.toISOString();
      cron.runCount = (cron.runCount || 0) + 1;
      cron.lastResult = result.slice(0, 200);
    } catch (err) {
      console.error(`  Cron error (${cron.name}): ${err.message}`);
      results.push({ id: cron.id, name: cron.name, status: 'error', error: err.message });
      cron.lastRun = now.toISOString();
      cron.lastResult = `Error: ${err.message}`;
    }
  }

  // Save updated run times
  if (results.length > 0) {
    await saveCrons(crons);
  }

  return results;
}

async function executeCronJob(cron, now) {
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  // Get daily note for context
  const daily = await getDailySoFar();
  const dailyContext = daily
    ? `\n\nToday's journal so far:\n${daily.replace(/^---[\s\S]*?---\s*/, '').slice(0, 2000)}`
    : '';

  // Disposable session — quick model, has tools, no history
  const session = new Session({ role: 'quick' });
  await session.init();

  const prompt = `SCHEDULED TASK — ${timeStr}
Cron: "${cron.name}" (${cron.schedule})

${cron.prompt}
${dailyContext}

Execute this task. Use your tools as needed. Be efficient. Log what you did to the journal under "Cron Log".`;

  let responseText = '';
  for await (const event of session.sendStream(prompt)) {
    if (event.type === 'text') {
      responseText += event.text;
    }
  }

  return responseText || '(no output)';
}
