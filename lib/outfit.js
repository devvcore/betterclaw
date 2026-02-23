import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import config from '../config.js';

// Simple YAML frontmatter parser (same as context.js)
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
        lines.push(`${key}: [${val.join(', ')}]`);
      }
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + content;
}

async function ensureOutfitsDir() {
  if (!existsSync(config.outfitsDir)) {
    await mkdir(config.outfitsDir, { recursive: true });
  }
}

export async function listOutfits() {
  await ensureOutfitsDir();
  const dir = config.outfitsDir;
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const outfits = [];
  for (const file of files.filter(f => f.endsWith('.md'))) {
    const raw = await readFile(join(dir, file), 'utf-8');
    const { data } = parseFrontmatter(raw);
    outfits.push({
      name: data.name || basename(file, '.md'),
      description: data.description || '',
      tools: data.tools || [],
      contexts: data.contexts || [],
    });
  }
  return outfits;
}

export async function loadOutfit(name) {
  await ensureOutfitsDir();
  const dir = config.outfitsDir;
  const directPath = join(dir, `${name}.md`);

  let filePath;
  if (existsSync(directPath)) {
    filePath = directPath;
  } else {
    const files = await readdir(dir);
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const raw = await readFile(join(dir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      if (data.name === name) {
        filePath = join(dir, file);
        break;
      }
    }
  }

  if (!filePath) return null;

  const raw = await readFile(filePath, 'utf-8');
  const { data, content } = parseFrontmatter(raw);

  return {
    name: data.name || name,
    description: data.description || '',
    tools: data.tools || [],
    contexts: data.contexts || [],
    content: content.trim(),
  };
}

export async function createOutfit(name, opts = {}) {
  await ensureOutfitsDir();
  const filePath = join(config.outfitsDir, `${name}.md`);
  if (existsSync(filePath)) {
    throw new Error(`Outfit "${name}" already exists`);
  }

  const frontmatter = {
    name,
    description: opts.description || '',
    tools: opts.tools || [],
    contexts: opts.contexts || [],
  };

  const body = opts.content || '';
  const content = stringifyFrontmatter(body, frontmatter);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}
