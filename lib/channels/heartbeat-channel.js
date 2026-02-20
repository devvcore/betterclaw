import { runHeartbeat } from '../heartbeat.js';

export async function runHeartbeatChannel() {
  const start = Date.now();

  try {
    const result = await runHeartbeat();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (result.events === 0) {
      // Silent exit — nothing happened
      return;
    }

    console.log(`Heartbeat: ${result.events} events, ${result.actions.length} actions (${elapsed}s)`);
    for (const action of result.actions) {
      console.log(`  [${action.action}] ${action.event}`);
    }
  } catch (err) {
    console.error(`Heartbeat error: ${err.message}`);
    process.exit(1);
  }
}
