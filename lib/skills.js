import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import config from '../config.js';

const SKILLS_DIR = join(config.vault, config.skillsDir);

async function ensureSkillsDir() {
  if (!existsSync(SKILLS_DIR)) {
    await mkdir(SKILLS_DIR, { recursive: true });
  }
}

/**
 * List all available skills
 * Returns: [{ name, description, path }]
 */
export async function listSkills() {
  await ensureSkillsDir();

  try {
    const files = await readdir(SKILLS_DIR);
    const skills = [];

    for (const file of files.filter(f => f.endsWith('.md'))) {
      const fullPath = join(SKILLS_DIR, file);
      const content = await readFile(fullPath, 'utf-8');

      // Extract description from first paragraph or frontmatter
      const name = file.replace(/\.md$/, '');
      let description = '';

      // Try frontmatter description
      const fmMatch = content.match(/^---[\s\S]*?description:\s*(.+?)[\r\n][\s\S]*?---/);
      if (fmMatch) {
        description = fmMatch[1].trim();
      } else {
        // Use first non-heading, non-empty line
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
            description = trimmed.slice(0, 120);
            break;
          }
        }
      }

      skills.push({ name, description, path: fullPath });
    }

    return skills;
  } catch {
    return [];
  }
}

/**
 * Read a skill's full content
 */
export async function readSkill(name) {
  await ensureSkillsDir();
  const safeName = name.replace(/\.md$/, '');
  const path = join(SKILLS_DIR, `${safeName}.md`);

  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Create or update a skill
 */
export async function writeSkill(name, content) {
  await ensureSkillsDir();
  const safeName = name.replace(/\.md$/, '').replace(/[/\\]/g, '-');
  const path = join(SKILLS_DIR, `${safeName}.md`);
  await writeFile(path, content, 'utf-8');
  return { name: safeName, path };
}

/**
 * Delete a skill
 */
export async function deleteSkill(name) {
  const safeName = name.replace(/\.md$/, '');
  const path = join(SKILLS_DIR, `${safeName}.md`);
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get skills summary for system prompt
 * Returns a compact listing of all skills
 */
export async function getSkillsSummary() {
  const skills = await listSkills();
  if (skills.length === 0) return '';

  const lines = skills.map(s => {
    const desc = s.description ? ` — ${s.description}` : '';
    return `  ${s.name}${desc}`;
  });

  return `--- Available Skills (use load_skill to read full instructions) ---\n${lines.join('\n')}`;
}
