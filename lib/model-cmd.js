import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import config, { defaults, userConfigPath } from '../config.js';

const ROLES = ['router', 'quick', 'default', 'deep'];

const KNOWN_PROVIDERS = ['anthropic', 'openai', 'ollama', 'openrouter', 'together', 'groq', 'generic'];

export function showModels() {
  console.log('Model configuration:');
  console.log();
  for (const role of ROLES) {
    const spec = config.models[role];
    if (!spec) {
      console.log(`  ${role.padEnd(10)} (not set)`);
      continue;
    }
    const isDefault = defaults.models[role]
      && defaults.models[role].provider === spec.provider
      && defaults.models[role].model === spec.model;
    const tag = isDefault ? '' : ' \x1b[33m(custom)\x1b[0m';
    console.log(`  ${role.padEnd(10)} ${spec.provider}/${spec.model}${tag}`);
  }
  console.log();
  console.log('Change with: betterbot model set <role> <provider/model>');
  console.log(`Config file: ${userConfigPath}`);
}

export async function setModel(role, spec) {
  if (!ROLES.includes(role)) {
    console.error(`Unknown role: ${role}`);
    console.error(`Valid roles: ${ROLES.join(', ')}`);
    return;
  }

  // Parse provider/model — handle openrouter paths like openrouter/anthropic/claude-sonnet-4-5
  const slashIdx = spec.indexOf('/');
  if (slashIdx === -1) {
    console.error('Format: provider/model (e.g. anthropic/claude-sonnet-4-5-20250514)');
    return;
  }

  const provider = spec.slice(0, slashIdx);
  const model = spec.slice(slashIdx + 1);

  if (!KNOWN_PROVIDERS.includes(provider)) {
    console.log(`\x1b[33mWarning: "${provider}" is not a known provider (${KNOWN_PROVIDERS.join(', ')})\x1b[0m`);
    console.log('Proceeding anyway — it may work if you have a custom provider.\n');
  }

  // Read existing user config
  let userConfig = {};
  try {
    userConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8'));
  } catch { /* no existing config */ }

  // Merge
  if (!userConfig.models) userConfig.models = {};
  userConfig.models[role] = { provider, model };

  // Write
  mkdirSync(dirname(userConfigPath), { recursive: true });
  writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2) + '\n', 'utf-8');

  console.log(`Updated ${role}: ${provider}/${model}`);
  console.log(`Saved to: ${userConfigPath}`);
  console.log('\nNote: restart gateway or start a new chat session to use the new model.');
}
