import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import config from '../config.js';

const TOOLS_DIR = join(config.dataDir, 'custom-tools');

// Loaded custom tools (mutable — supports hot reload)
let customTools = [];

export async function ensureToolsDir() {
  if (!existsSync(TOOLS_DIR)) {
    await mkdir(TOOLS_DIR, { recursive: true });
  }
}

/**
 * Load all custom tools from ~/.betterclaw/custom-tools/
 * Each file should export default { name, description, parameters, execute }
 */
export async function loadCustomTools() {
  await ensureToolsDir();
  const files = await readdir(TOOLS_DIR);
  const jsFiles = files.filter(f => f.endsWith('.js'));

  const loaded = [];
  for (const file of jsFiles) {
    try {
      const fullPath = join(TOOLS_DIR, file);
      // Use cache-busting query param so re-imports pick up changes
      const url = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
      const mod = await import(url);
      const tool = mod.default;

      if (!tool?.name || !tool?.execute) {
        console.error(`Custom tool ${file}: missing name or execute, skipping`);
        continue;
      }

      // Ensure it has the right shape
      loaded.push({
        name: tool.name,
        description: tool.description || `Custom tool: ${tool.name}`,
        parameters: tool.parameters || { type: 'object', properties: {}, required: [] },
        execute: tool.execute,
        _source: file,
        _custom: true,
      });
    } catch (err) {
      console.error(`Custom tool ${file}: load error: ${err.message}`);
    }
  }

  customTools = loaded;
  return loaded;
}

/**
 * Get currently loaded custom tools
 */
export function getCustomTools() {
  return customTools;
}

/**
 * Create a new custom tool file and hot-load it.
 *
 * The tool file is a full ES module. The agent provides:
 * - imports: top-level import statements (e.g. "import { connect } from 'node:tls';")
 * - code: the async execute function body (has access to args, session, and anything imported)
 *
 * @param {string} name - Tool name (snake_case)
 * @param {string} description - What the tool does
 * @param {object} parameters - JSON Schema for parameters
 * @param {string} code - The execute function body OR a full module body.
 *   If code contains "export default", it's used as-is (full module).
 *   Otherwise it's wrapped in the standard template.
 * @param {string} [imports] - Optional import statements to put at the top of the file.
 */
export async function createCustomTool(name, description, parameters, code, imports) {
  await ensureToolsDir();

  const safeName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  const filePath = join(TOOLS_DIR, `${safeName}.js`);

  let fileContent;

  if (code.includes('export default')) {
    // Full module provided — use as-is
    fileContent = `// Custom tool: ${name}\n// Created: ${new Date().toISOString()}\n\n${code}\n`;
  } else {
    // Wrap in template
    const importBlock = imports ? imports + '\n\n' : '';
    fileContent = `// Custom tool: ${name}
// Created: ${new Date().toISOString()}
// Auto-generated custom tool. Edit with care.

${importBlock}export default {
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  parameters: ${JSON.stringify(parameters, null, 2)},
  async execute(args, session) {
${code.split('\n').map(line => '    ' + line).join('\n')}
  },
};
`;
  }

  await writeFile(filePath, fileContent, 'utf-8');

  // Try to load it — verify it actually works before reporting success
  try {
    const url = pathToFileURL(filePath).href + `?t=${Date.now()}`;
    const mod = await import(url);
    const tool = mod.default;

    if (!tool?.name || !tool?.execute) {
      // File loads but doesn't have the right shape
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);
      throw new Error('Tool module loaded but is missing "name" or "execute". Make sure the code exports default { name, execute, ... }');
    }

    // It works — reload all tools
    await loadCustomTools();
    return { name, path: filePath };
  } catch (err) {
    // Clean up the broken file
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);
    } catch {}
    await loadCustomTools(); // Reload without the broken file

    // Surface the ACTUAL error to the agent so it can fix it
    throw new Error(`Tool failed to load (file deleted): ${err.message}\n\nGenerated code:\n${fileContent.slice(0, 500)}`);
  }
}

/**
 * Delete a custom tool
 */
export async function deleteCustomTool(name) {
  await ensureToolsDir();
  const files = await readdir(TOOLS_DIR);

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    try {
      const fullPath = join(TOOLS_DIR, file);
      const url = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
      const mod = await import(url);
      if (mod.default?.name === name) {
        const { unlink } = await import('node:fs/promises');
        await unlink(fullPath);
        await loadCustomTools(); // Reload
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * List all custom tools with their source files
 */
export async function listCustomTools() {
  await loadCustomTools();
  return customTools.map(t => ({
    name: t.name,
    description: t.description,
    source: t._source,
  }));
}

/**
 * Read the source code of a custom tool
 */
export async function readCustomToolSource(name) {
  await ensureToolsDir();
  const files = await readdir(TOOLS_DIR);

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const fullPath = join(TOOLS_DIR, file);
    const content = await readFile(fullPath, 'utf-8');
    if (content.includes(`name: ${JSON.stringify(name)}`)) {
      return content;
    }
  }
  return null;
}
