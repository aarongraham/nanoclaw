/**
 * Register the Argos dev agent in the v2 entity model.
 *
 * Rewrite of v1's register-dev-agent.ts for v2 schema:
 *   - agent_groups row (no container_config column — that moves to JSON file)
 *   - groups/dev-agent/container.json (custom image + additional mounts)
 *   - messaging_groups row for the Telegram DM
 *   - messaging_group_agents wiring (engage_mode='pattern', engage_pattern='.')
 *
 * Pattern-matched from scripts/init-first-agent.ts.
 *
 * Usage: pnpm exec tsx scripts/register-dev-agent.ts <telegram_chat_id>
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from '../src/config.js';
import { getContainerImageBase } from '../src/install-slug.js';
import { createAgentGroup, getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { initDb } from '../src/db/connection.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
} from '../src/db/messaging-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { initGroupFilesystem } from '../src/group-init.js';
import type { AgentGroup } from '../src/types.js';

const FOLDER = 'dev-agent';
const AGENT_NAME = 'Argos Dev Agent';

// Compute the per-install dev-agent image tag. v2 images are named
// `nanoclaw-agent-v2-<slug>` where <slug> comes from install-slug.sh; for the
// dev-agent variant we swap the "agent" prefix for "dev-agent". Callers can
// override via the IMAGE_TAG env var.
function resolveDevAgentImageTag(): string {
  if (process.env.IMAGE_TAG) return process.env.IMAGE_TAG;
  const base = getContainerImageBase(process.cwd()); // e.g. nanoclaw-agent-v2-<slug>
  const devBase = base.replace(/^nanoclaw-agent/, 'nanoclaw-dev-agent');
  return `${devBase}:latest`;
}

// Normalize a Telegram chat id to a v2 platform_id. v1 used JID syntax
// (`tg:-<id>`); v2 expects the bare chat id prefixed with the channel name
// (`telegram:<id>`). Strip any legacy prefix the env var might carry.
function normalizeTelegramPlatformId(raw: string): string {
  const bare = raw.replace(/^tg:/, '').replace(/^telegram:/, '');
  return `telegram:${bare}`;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeDevAgentContainerConfig(folder: string, imageTag: string): void {
  const p = path.join(GROUPS_DIR, folder, 'container.json');
  const config = {
    mcpServers: {},
    packages: { apt: [], npm: [] },
    imageTag,
    additionalMounts: [
      {
        hostPath: '/opt/argos',
        containerPath: 'argos',
        readonly: false,
      },
    ],
    skills: 'all' as const,
    groupName: AGENT_NAME,
    assistantName: 'Argos',
  };
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
  console.log(`Wrote container.json with image=${imageTag}`);
}

async function main(): Promise<void> {
  const telegramChatId = process.argv[2];
  if (!telegramChatId) {
    console.error('Usage: register-dev-agent.ts <telegram_chat_id>');
    process.exit(2);
  }

  const db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(db);

  const now = new Date().toISOString();

  // 1. Agent group — no container_config in v2; that goes in container.json.
  let ag: AgentGroup | undefined = getAgentGroupByFolder(FOLDER);
  if (!ag) {
    createAgentGroup({
      id: generateId('ag'),
      name: AGENT_NAME,
      folder: FOLDER,
      agent_provider: null,
      created_at: now,
    });
    ag = getAgentGroupByFolder(FOLDER)!;
    console.log(`Created agent group: ${ag.id} (${FOLDER})`);
  } else {
    console.log(`Reusing agent group: ${ag.id} (${FOLDER})`);
  }

  // 2. Scaffold group filesystem (creates groups/dev-agent/, CLAUDE.local.md, container.json stub)
  initGroupFilesystem(ag, {
    instructions:
      `# ${AGENT_NAME}\n\n` +
      `You are the Argos dev agent. You work on the Argos Elixir project at ` +
      `/workspace/extra/argos. Use TASKS.md for the work queue; fall back to the ` +
      `CSV queue if TASKS.md is empty. Commit, push, deploy via Disco when work ` +
      `is complete. Keep the dev loop running until there's nothing left to do.`,
  });

  // 3. Overwrite container.json with dev-agent-specific config
  //    (custom image + /opt/argos mount). This replaces the empty stub
  //    written by initGroupFilesystem above.
  writeDevAgentContainerConfig(FOLDER, resolveDevAgentImageTag());

  // 4. Messaging group for the Telegram DM
  const platformId = normalizeTelegramPlatformId(telegramChatId);
  let mg = getMessagingGroupByPlatform('telegram', platformId);
  if (!mg) {
    createMessagingGroup({
      id: generateId('mg'),
      channel_type: 'telegram',
      platform_id: platformId,
      name: 'Argos Dev Chat',
      is_group: 0, // DM, not group
      unknown_sender_policy: 'strict',
      created_at: now,
    });
    mg = getMessagingGroupByPlatform('telegram', platformId)!;
    console.log(`Created messaging group: ${mg.id} (${platformId})`);
  } else {
    console.log(`Reusing messaging group: ${mg.id} (${platformId})`);
  }

  // 5. Wire messaging group to agent (idempotent)
  const existing = getMessagingGroupAgentByPair(mg.id, ag.id);
  if (existing) {
    console.log(`Wiring already exists: ${existing.id}`);
  } else {
    createMessagingGroupAgent({
      id: generateId('mga'),
      messaging_group_id: mg.id,
      agent_group_id: ag.id,
      engage_mode: 'pattern',     // match all messages (dev agent takes everything)
      engage_pattern: '.',         // '.' = always-match sentinel
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',      // single long-running session for the dev loop
      priority: 100,
      created_at: now,
    });
    console.log(`Wired messaging_group ${mg.id} -> agent_group ${ag.id}`);
  }

  console.log('');
  console.log('Dev agent registered.');
  console.log(`  agent:   ${AGENT_NAME} [${ag.id}] @ groups/${FOLDER}`);
  console.log(`  channel: telegram ${platformId}`);
  console.log(`  image:   ${resolveDevAgentImageTag()}`);
  console.log('');
  console.log('Next: build the image with ./container/build-dev-agent.sh');
  console.log('Then send a message from the Telegram chat to wake the dev agent.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
