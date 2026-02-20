import { startPanel } from './panel/server.js';
import { startTelegramBot } from './channels/telegram.js';
import { runHeartbeat } from './heartbeat.js';
import { runCronTick } from './crons.js';
import { appendEntry } from './journal.js';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLIST_LABEL = 'com.betterclaw.gateway';
const PLIST_PATH = join(homedir(), 'Library/LaunchAgents', `${PLIST_LABEL}.plist`);
const LOG_DIR = join(homedir(), 'Library/Logs/betterclaw');
const LOG_PATH = join(LOG_DIR, 'gateway.log');
const PID_PATH = join(config.dataDir, 'gateway.pid');

// Shared gateway state — accessible from the API for hot-reload
export const gatewayState = {
  running: false,
  startedAt: null,
  heartbeatTimer: null,
  heartbeatIntervalMs: 0,
  cronTimer: null,
  telegramStop: null,
  server: null,
  lastHeartbeat: null,
  heartbeatCount: 0,
  lastCronCheck: null,
  cronRunCount: 0,
};

async function runHeartbeatTick() {
  try {
    const result = await runHeartbeat();
    gatewayState.lastHeartbeat = new Date().toISOString();
    gatewayState.heartbeatCount++;
    if (result.events > 0) {
      console.log(`  Heartbeat: ${result.events} events, ${result.actions.length} actions`);
    }
  } catch (err) {
    console.error(`  Heartbeat error: ${err.message}`);
  }
}

async function runCronTickSafe() {
  try {
    const results = await runCronTick();
    gatewayState.lastCronCheck = new Date().toISOString();
    if (results.length > 0) {
      gatewayState.cronRunCount += results.length;
      console.log(`  Crons: ${results.length} jobs fired`);
      for (const r of results) {
        console.log(`    ${r.name}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
      }
    }
  } catch (err) {
    console.error(`  Cron tick error: ${err.message}`);
  }
}

// Hot-reload heartbeat interval (called from API when config changes)
export function reloadHeartbeatInterval(intervalMinutes) {
  if (gatewayState.heartbeatTimer) {
    clearInterval(gatewayState.heartbeatTimer);
  }
  const ms = (intervalMinutes || 15) * 60 * 1000;
  gatewayState.heartbeatIntervalMs = ms;
  gatewayState.heartbeatTimer = setInterval(runHeartbeatTick, ms);
  console.log(`  Heartbeat: interval changed to ${intervalMinutes}m`);
}

export async function startGateway(opts = {}) {
  const port = opts.port || 3333;

  console.log('BetterClaw Gateway starting...');

  // Write PID file
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));

  // 1. Start HTTP panel (no browser open in gateway mode)
  gatewayState.server = startPanel({ port, noBrowser: true });
  console.log(`  Panel: http://localhost:${port}`);

  // 2. Start Telegram bot (if token configured)
  try {
    gatewayState.telegramStop = await startTelegramBot();
    console.log('  Telegram: connected');
  } catch (err) {
    console.log(`  Telegram: skipped (${err.message})`);
  }

  // 3. Start heartbeat timer
  const intervalMinutes = config.heartbeat?.intervalMinutes || 15;
  const heartbeatMs = intervalMinutes * 60 * 1000;
  gatewayState.heartbeatIntervalMs = heartbeatMs;
  gatewayState.heartbeatTimer = setInterval(runHeartbeatTick, heartbeatMs);

  // Run initial heartbeat after a short delay
  setTimeout(runHeartbeatTick, 5000);

  // 4. Start cron scheduler — checks every 60 seconds
  gatewayState.cronTimer = setInterval(runCronTickSafe, 60 * 1000);
  // First cron check after 10s (after heartbeat)
  setTimeout(runCronTickSafe, 10000);

  gatewayState.running = true;
  gatewayState.startedAt = new Date().toISOString();

  console.log(`  Heartbeat: every ${intervalMinutes}m`);
  console.log('  Crons: checking every 60s');
  console.log('Gateway running. Press Ctrl+C to stop.');

  // No journal entry for gateway start/stop — avoid clutter

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\nShutting down (${signal})...`);
    clearInterval(gatewayState.heartbeatTimer);
    clearInterval(gatewayState.cronTimer);
    if (gatewayState.telegramStop) gatewayState.telegramStop();
    if (gatewayState.server) gatewayState.server.close();
    try { unlinkSync(PID_PATH); } catch {}
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export function installLaunchAgent() {
  let nodePath;
  try {
    nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    nodePath = process.execPath;
  }

  const clawPath = join(__dirname, '..', 'bin', 'claw');
  mkdirSync(LOG_DIR, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>--use-system-ca</string>
    <string>${clawPath}</string>
    <string>gateway</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>`;

  const launchAgentsDir = join(homedir(), 'Library/LaunchAgents');
  mkdirSync(launchAgentsDir, { recursive: true });
  writeFileSync(PLIST_PATH, plist);

  try {
    execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {}
  execSync(`launchctl load "${PLIST_PATH}"`);

  console.log('LaunchAgent installed:');
  console.log(`  Plist: ${PLIST_PATH}`);
  console.log(`  Logs:  ${LOG_PATH}`);
  console.log('Gateway will start on login and auto-restart if it crashes.');
}

export function uninstallLaunchAgent() {
  try {
    execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {}

  try {
    unlinkSync(PLIST_PATH);
    console.log('LaunchAgent removed.');
  } catch {
    console.log('LaunchAgent was not installed.');
  }
}

export function gatewayStatus() {
  let pid = null;
  try {
    pid = readFileSync(PID_PATH, 'utf-8').trim();
  } catch {}

  if (pid) {
    try {
      process.kill(Number(pid), 0);
      console.log(`Gateway is running (PID ${pid})`);
    } catch {
      console.log('Gateway is not running (stale PID file)');
    }
  } else {
    console.log('Gateway is not running');
  }

  if (existsSync(PLIST_PATH)) {
    console.log(`LaunchAgent: installed (${PLIST_PATH})`);
  } else {
    console.log('LaunchAgent: not installed');
  }
}

export function gatewayLogs() {
  if (!existsSync(LOG_PATH)) {
    console.log('No gateway logs found.');
    console.log(`Expected at: ${LOG_PATH}`);
    return;
  }

  try {
    execSync(`tail -50 "${LOG_PATH}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Error reading logs: ${err.message}`);
  }
}
