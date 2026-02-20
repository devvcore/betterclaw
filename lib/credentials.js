import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SERVICE = 'betterclaw';

// macOS Keychain via `security` CLI

export async function getCredential(name) {
  // 1. Try env var first (CI / override)
  const envKey = name.toUpperCase();
  if (process.env[envKey]) return process.env[envKey];

  // 2. Try macOS Keychain
  try {
    const { stdout } = await exec('security', [
      'find-generic-password',
      '-s', SERVICE,
      '-a', name,
      '-w',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function setCredential(name, value) {
  // Delete existing entry (ignore errors if not found)
  try {
    await exec('security', [
      'delete-generic-password',
      '-s', SERVICE,
      '-a', name,
    ]);
  } catch { /* not found, fine */ }

  await exec('security', [
    'add-generic-password',
    '-s', SERVICE,
    '-a', name,
    '-w', value,
    '-U',
  ]);
}

export async function removeCredential(name) {
  try {
    await exec('security', [
      'delete-generic-password',
      '-s', SERVICE,
      '-a', name,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function listCredentials() {
  // Check which known keys are stored
  const { default: config } = await import('../config.js');
  const results = [];
  for (const key of config.credentialKeys) {
    const val = await getCredential(key);
    results.push({ name: key, configured: val !== null });
  }
  return results;
}
