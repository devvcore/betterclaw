import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import config from '../config.js';

const exec = promisify(execFile);

export async function search(query, opts = {}) {
  const dir = opts.dir || config.vault;
  const maxResults = opts.maxResults || 20;

  try {
    const { stdout } = await exec('rg', [
      '--json',
      '--max-count', '3',
      '--max-filesize', '100K',
      '--glob', '*.md',
      '--ignore-case',
      query,
      dir,
    ], { maxBuffer: 1024 * 1024 });

    const results = new Map();
    for (const line of stdout.split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'match') {
          const file = entry.data.path.text;
          if (!results.has(file)) {
            results.set(file, { file, matches: [] });
          }
          results.get(file).matches.push({
            line: entry.data.line_number,
            text: entry.data.lines.text.trim(),
          });
        }
      } catch { /* skip malformed */ }
    }

    return [...results.values()].slice(0, maxResults);
  } catch (err) {
    // rg returns exit code 1 when no matches found
    if (err.code === 1) return [];
    throw err;
  }
}

export async function findRecent(dir, minutes = 15) {
  const cutoff = Date.now() - minutes * 60 * 1000;
  const targetDir = dir || join(config.vault, config.para.inbox);
  const results = [];

  try {
    const files = await readdir(targetDir);
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const filePath = join(targetDir, file);
      const info = await stat(filePath);
      if (info.mtimeMs > cutoff) {
        results.push({ file: filePath, modified: info.mtime });
      }
    }
  } catch { /* dir might not exist */ }

  return results.sort((a, b) => b.modified - a.modified);
}
