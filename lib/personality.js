import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import config from '../config.js';

const PERSONALITY_FILE = join(config.dataDir, 'personality.md');

/**
 * Read the agent's current personality file.
 * Returns null if no personality has been set yet.
 */
export async function getPersonality() {
  try {
    return await readFile(PERSONALITY_FILE, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write the agent's personality file (full replace).
 * The agent uses this to define its own voice, tone, quirks, and self-expression.
 */
export async function setPersonality(content) {
  const dir = dirname(PERSONALITY_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(PERSONALITY_FILE, content, 'utf-8');
  return `Personality updated (${PERSONALITY_FILE}).`;
}

/**
 * Append a line/section to the personality file.
 * Creates the file with a default header if it doesn't exist yet.
 */
export async function appendPersonality(content) {
  const dir = dirname(PERSONALITY_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  let existing;
  try {
    existing = await readFile(PERSONALITY_FILE, 'utf-8');
  } catch {
    existing = '# My Personality\n';
  }

  const updated = existing.trimEnd() + '\n' + content + '\n';
  await writeFile(PERSONALITY_FILE, updated, 'utf-8');
  return `Personality updated — appended to ${PERSONALITY_FILE}.`;
}
