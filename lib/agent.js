import { createProvider } from './provider.js';
import { buildSystemPrompt } from './identity.js';
import { appendEntry } from './journal.js';

// Stateless sub-agent: runs a task, writes results, exits
export async function spawnAgent(task, opts = {}) {
  const role = opts.role || 'quick';
  const provider = createProvider(role);
  const contexts = opts.contexts || [];

  const systemPrompt = await buildSystemPrompt(contexts);

  const taskPrompt = `You are running as a sub-agent for a specific task. Complete the task and provide your output concisely.

Task: ${task}

${opts.additionalContext || ''}`;

  const result = await provider.chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: taskPrompt },
  ], { maxTokens: opts.maxTokens || 2048 });

  // Don't log sub-agent spawns to the journal — they go to the audit log instead.
  // Only log if explicitly requested with journal: true and a section.
  if (opts.journal === true && opts.journalSection) {
    await appendEntry(`**Sub-agent (${role}):** ${task.slice(0, 80)}`, opts.journalSection);
  }

  return {
    content: result.content,
    usage: result.usage,
    role,
  };
}

// Run a batch of tasks in parallel
export async function spawnAgents(tasks) {
  return Promise.all(tasks.map(t => spawnAgent(t.task, t.opts)));
}
