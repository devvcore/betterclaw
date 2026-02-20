import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import config from '../config.js';

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
    const { data } = matter(content);
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
      const { data } = matter(content);
      if (data.name === name) {
        filePath = join(dir, file);
        break;
      }
    }
  }

  if (!filePath) return null;

  const raw = await readFile(filePath, 'utf-8');
  const { data, content } = matter(raw);

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
  const content = matter.stringify(body, frontmatter);
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
