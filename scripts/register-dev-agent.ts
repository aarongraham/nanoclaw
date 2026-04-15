/**
 * Registers the dev-agent group in NanoClaw's database.
 * Usage: npx tsx scripts/register-dev-agent.ts <telegram-chat-id>
 *
 * The Telegram chat ID for a private chat is a positive number (e.g. 123456789).
 * For a group chat it is negative (e.g. -987654321).
 * NanoClaw stores Telegram JIDs as "tg:<id>".
 */

import { initDatabase, setRegisteredGroup, getAllRegisteredGroups } from '../src/db.js';
import type { RegisteredGroup } from '../src/types.js';

initDatabase();

const chatIdArg = process.argv[2];

if (!chatIdArg) {
  console.error('Usage: npx tsx scripts/register-dev-agent.ts <telegram-chat-id>');
  console.error('Example: npx tsx scripts/register-dev-agent.ts 123456789');
  process.exit(1);
}

const jid = chatIdArg.startsWith('tg:') ? chatIdArg : `tg:${chatIdArg}`;

const existing = getAllRegisteredGroups();
if (existing[jid]) {
  console.log(`Group already registered for ${jid}:`);
  console.log(JSON.stringify(existing[jid], null, 2));
  console.log('\nRe-registering with updated config...');
}

const group: RegisteredGroup = {
  name: 'Argos Dev Agent',
  folder: 'dev-agent',
  trigger: '',
  added_at: new Date().toISOString(),
  requiresTrigger: false,   // respond to all messages, no trigger word needed
  isMain: false,
  isolateMemory: true,      // fully separate persona, no shared memory
  containerConfig: {
    image: 'nanoclaw-dev-agent:latest',
    timeout: 1800000, // 30 minutes — Claude Code tasks can be slow
    additionalMounts: [
      {
        hostPath: '/opt/argos',
        containerPath: 'argos',
        readonly: false,
      },
    ],
  },
};

setRegisteredGroup(jid, group);

console.log(`\nDev-agent group registered:`);
console.log(`  JID:     ${jid}`);
console.log(`  Folder:  groups/dev-agent/`);
console.log(`  Image:   nanoclaw-dev-agent:latest`);
console.log(`  Mount:   /opt/argos → /workspace/extra/argos (read-write)`);
console.log(`  Timeout: 30 minutes`);
console.log(`\nRestart NanoClaw to pick up the new group.`);
