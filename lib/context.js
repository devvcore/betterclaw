import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import config from '../config.js';

// Simple YAML frontmatter parser — replaces gray-matter dependency
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const yaml = match[1];
  const content = match[2];
  const data = {};

  let currentKey = null;
  let inArray = false;

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (inArray && trimmed.startsWith('- ')) {
      if (currentKey && Array.isArray(data[currentKey])) {
        data[currentKey].push(trimmed.slice(2).trim());
      }
      continue;
    }

    inArray = false;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (val === '' || val === '[]') {
      // Could be start of array block or empty value
      data[key] = [];
      currentKey = key;
      inArray = true;
    } else if (val === 'true') {
      data[key] = true;
    } else if (val === 'false') {
      data[key] = false;
    } else if (/^\d+(\.\d+)?$/.test(val)) {
      data[key] = Number(val);
    } else if (val.startsWith('[') && val.endsWith(']')) {
      // Inline array: [a, b, c]
      const inner = val.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];
    } else {
      data[key] = val.replace(/^['"]|['"]$/g, '');
    }
    currentKey = key;
  }

  return { data, content };
}

function stringifyFrontmatter(content, data) {
  const lines = ['---'];
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of val) lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + content;
}

// Rough token estimate: ~4 chars per token
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export async function listContexts() {
  const dir = config.contextsDir;
  const files = await readdir(dir);
  const contexts = [];

  for (const file of files.filter(f => f.endsWith('.md'))) {
    const content = await readFile(join(dir, file), 'utf-8');
    const { data } = parseFrontmatter(content);
    contexts.push({
      name: data.name || basename(file, '.md'),
      file,
      type: data.type || 'general',
      tokens: estimateTokens(content),
      alwaysLoad: file.startsWith('_') && data.type !== 'template',
    });
  }

  return contexts;
}

export async function loadContext(name) {
  // Try exact filename first, then search by frontmatter name
  const dir = config.contextsDir;
  const directPath = join(dir, `${name}.md`);

  let filePath;
  if (existsSync(directPath)) {
    filePath = directPath;
  } else {
    const files = await readdir(dir);
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const content = await readFile(join(dir, file), 'utf-8');
      const { data } = parseFrontmatter(content);
      if (data.name === name) {
        filePath = join(dir, file);
        break;
      }
    }
  }

  if (!filePath) return null;

  const raw = await readFile(filePath, 'utf-8');
  const { data, content } = parseFrontmatter(raw);

  // Resolve source files if specified
  let resolvedSources = '';
  if (data.sources?.length) {
    const parts = [];
    for (const src of data.sources) {
      const expanded = src.replace(/^~/, process.env.HOME);
      try {
        const srcContent = await readFile(expanded, 'utf-8');
        parts.push(`\n--- Source: ${basename(expanded)} ---\n${srcContent}`);
      } catch {
        parts.push(`\n--- Source: ${basename(expanded)} (not found) ---`);
      }
    }
    resolvedSources = parts.join('\n');
  }

  return {
    name: data.name || name,
    type: data.type || 'general',
    content: content.trim() + resolvedSources,
    metadata: data,
    tokens: estimateTokens(content + resolvedSources),
  };
}

export async function createContext(name, opts = {}) {
  const filePath = join(config.contextsDir, `${name}.md`);
  if (existsSync(filePath)) {
    throw new Error(`Context "${name}" already exists`);
  }

  const frontmatter = {
    name,
    type: opts.type || 'project',
    sources: opts.sources || [],
  };

  const body = opts.content || `# ${name} Context\n\n`;
  const content = stringifyFrontmatter(body, frontmatter);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function getAlwaysLoadedContexts() {
  const all = await listContexts();
  const loaded = [];
  for (const ctx of all.filter(c => c.alwaysLoad)) {
    const full = await loadContext(ctx.name);
    if (full) loaded.push(full);
  }
  return loaded;
}
