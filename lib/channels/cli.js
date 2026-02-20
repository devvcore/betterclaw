import { createInterface } from 'node:readline';
import { Session } from '../session.js';
import { listContexts } from '../context.js';
import { search } from '../search.js';
import config from '../../config.js';

const TOOL_ICONS = {
  search_vault: '🔍',
  read_file: '📖',
  write_file: '✏️',
  list_files: '📁',
  journal_append: '📝',
  journal_read: '📅',
  find_recent_files: '🕐',
  list_contexts: '📚',
  load_context: '🔗',
  spawn_subagent: '🤖',
};

function toolLabel(name) {
  return TOOL_ICONS[name] || '⚡';
}

export async function startCLI(opts = {}) {
  let session;

  if (opts.new) {
    session = new Session();
    await session.init();
    console.log(`New session: ${session.id}`);
  } else {
    try {
      session = await Session.latest();
    } catch { session = null; }

    if (session) {
      console.log(`Resumed session: ${session.id} (${session.messages.length} messages)`);
    } else {
      session = new Session();
      await session.init();
      console.log(`New session: ${session.id}`);
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[36mYou>\x1b[0m ',
  });

  console.log('\x1b[2mCommands: load <ctx>, drop <ctx>, contexts, search <query>, compact, new, status, quit\x1b[0m\n');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    try {
      if (input === 'quit' || input === 'exit') {
        await session.save();
        console.log('Session saved.');
        process.exit(0);
      }

      if (input === 'contexts') {
        const ctxs = await listContexts();
        console.log('\n\x1b[33mAvailable contexts:\x1b[0m');
        for (const ctx of ctxs) {
          const loaded = session.contexts.includes(ctx.name) ? ' \x1b[32m[loaded]\x1b[0m' : '';
          const auto = ctx.alwaysLoad ? ' \x1b[2m(auto)\x1b[0m' : '';
          console.log(`  ${ctx.name}  ~${ctx.tokens} tok${loaded}${auto}`);
        }
        console.log();
        rl.prompt();
        return;
      }

      if (input.startsWith('load ')) {
        const name = input.slice(5).trim();
        await session.loadContext(name);
        await session.save();
        console.log(`\x1b[32mLoaded: ${name}\x1b[0m\n`);
        rl.prompt();
        return;
      }

      if (input.startsWith('drop ')) {
        const name = input.slice(5).trim();
        await session.unloadContext(name);
        await session.save();
        console.log(`\x1b[33mDropped: ${name}\x1b[0m\n`);
        rl.prompt();
        return;
      }

      if (input.startsWith('search ')) {
        const query = input.slice(7).trim();
        console.log(`\x1b[2mSearching vault...\x1b[0m\n`);
        const results = await search(query);
        if (results.length === 0) {
          console.log('No matches.');
        } else {
          for (const r of results) {
            console.log(`\x1b[33m${r.file}\x1b[0m`);
            for (const m of r.matches) {
              console.log(`  L${m.line}: ${m.text}`);
            }
          }
        }
        console.log();
        rl.prompt();
        return;
      }

      if (input === 'compact') {
        console.log('\x1b[2mCompacting...\x1b[0m');
        await session.compact();
        console.log(`\x1b[32mDone. ${session.messages.length} messages remaining.\x1b[0m\n`);
        rl.prompt();
        return;
      }

      if (input === 'new') {
        await session.save();
        session = new Session();
        await session.init();
        console.log(`\x1b[32mNew session: ${session.id}\x1b[0m\n`);
        rl.prompt();
        return;
      }

      if (input === 'status') {
        console.log(`\n\x1b[33mSession:\x1b[0m ${session.id}`);
        console.log(`\x1b[33mMessages:\x1b[0m ${session.messages.length}`);
        console.log(`\x1b[33mContexts:\x1b[0m ${session.contexts.join(', ') || 'none (auto-loaded only)'}`);
        console.log();
        rl.prompt();
        return;
      }

      if (input === 'sessions') {
        const all = await Session.list();
        console.log('\n\x1b[33mSessions:\x1b[0m');
        for (const s of all.slice(0, 10)) {
          const active = s.id === session.id ? ' \x1b[32m← active\x1b[0m' : '';
          console.log(`  ${s.id}  ${s.messageCount} msgs  ${s.updated?.slice(0, 16) || ''}${active}`);
        }
        console.log();
        rl.prompt();
        return;
      }

      // Chat message — stream response with tool use display
      const label = config.agentName;
      process.stdout.write(`\x1b[35m${label}>\x1b[0m `);
      let hasStartedText = false;

      for await (const event of session.sendStream(input)) {
        if (event.type === 'text') {
          hasStartedText = true;
          process.stdout.write(event.text);
        } else if (event.type === 'tool_start') {
          // Show tool activity on its own line
          if (hasStartedText) process.stdout.write('\n');
          const icon = toolLabel(event.name);
          const argsPreview = Object.entries(event.arguments || {})
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : v}`)
            .join(', ');
          process.stdout.write(`\x1b[2m  ${icon} ${event.name}(${argsPreview})\x1b[0m\n`);
          hasStartedText = false;
        } else if (event.type === 'tool_result') {
          // Show abbreviated result
          const preview = (event.result || '').split('\n').slice(0, 3).join('\n');
          if (preview) {
            process.stdout.write(`\x1b[2m  → ${preview.slice(0, 120)}\x1b[0m\n`);
          }
          // Next text from the model needs the prefix again
          process.stdout.write(`\x1b[35m${label}>\x1b[0m `);
          hasStartedText = false;
        }
      }
      console.log('\n');

    } catch (err) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await session.save();
    console.log('\nSession saved.');
    process.exit(0);
  });
}
