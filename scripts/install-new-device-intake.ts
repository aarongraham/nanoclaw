/**
 * One-shot installer for new-device-intake. Idempotent.
 *
 * 1. Build the per-agent-group container image so packages.apt
 *    (python3-minimal, sqlite3) is layered on the base image.
 * 2. Insert (or update) a recurring schedule_task on the Telegram
 *    session's inbound.db that runs poll.py every 5 minutes.
 * 3. Persist the task id in the intake ledger's meta table.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { execSync } from 'child_process';

import { buildAgentGroupImage } from '../src/container-runner.js';
import { readContainerConfig } from '../src/container-config.js';
import { initDb } from '../src/db/connection.js';
import { insertTask, updateTask } from '../src/modules/scheduling/db.js';
import { DATA_DIR } from '../src/config.js';

const AGENT_GROUP_ID = 'ag-1777054402184-6vkllz';
const SESSION_ID = 'sess-1777054402190-bb548c'; // Telegram DM session
const FOLDER = 'dm-with-aaron';
const LEDGER = `groups/${FOLDER}/data/new-device-intake.db`;
const PROMPT = 'An unlabeled new device was detected on the home network. Use the new-device-intake skill at /home/node/.claude/skills/new-device-intake/ and follow the "Initial wake" branch of its SKILL.md. The device data is in your wake context.';
const SCRIPT = 'python3 /home/node/.claude/skills/new-device-intake/poll.py';
const RECURRENCE = '*/5 * * * *';

function genTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  initDb(path.join(DATA_DIR, 'v2.db'));

  // Step 1: build per-agent-group image
  const cfgBefore = readContainerConfig(FOLDER);
  if (cfgBefore.imageTag) {
    console.log(`[image] existing per-group image tag: ${cfgBefore.imageTag} — rebuilding to pick up packages.apt changes`);
  } else {
    console.log(`[image] no per-group image yet — building`);
  }
  await buildAgentGroupImage(AGENT_GROUP_ID);
  const cfgAfter = readContainerConfig(FOLDER);
  console.log(`[image] built: ${cfgAfter.imageTag}`);

  // Verify python3 + sqlite3 are now present
  execSync(`docker run --rm --entrypoint /bin/bash ${cfgAfter.imageTag} -c "python3 --version && sqlite3 --version"`, { stdio: 'inherit' });

  // Step 2: insert/update the schedule_task on the Telegram session
  const inboundPath = path.resolve(`data/v2-sessions/${AGENT_GROUP_ID}/${SESSION_ID}/inbound.db`);
  const ledgerDb = new Database(LEDGER);
  ledgerDb.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
  const existing = ledgerDb.prepare("SELECT value FROM meta WHERE key='schedule_task_id'").get() as { value: string } | undefined;
  const inDb = new Database(inboundPath);
  let taskId: string;

  if (existing) {
    taskId = existing.value;
    const touched = updateTask(inDb, taskId, {
      prompt: PROMPT,
      script: SCRIPT,
      recurrence: RECURRENCE,
    });
    if (touched > 0) {
      console.log(`[task] updated existing task ${taskId} (${touched} row(s))`);
    } else {
      console.log(`[task] previous task ${taskId} not found in inbound.db (likely already completed/cancelled) — inserting fresh`);
      taskId = genTaskId();
      insertTask(inDb, {
        id: taskId,
        processAfter: new Date().toISOString(),
        recurrence: RECURRENCE,
        platformId: null,
        channelType: null,
        threadId: null,
        content: JSON.stringify({ prompt: PROMPT, script: SCRIPT }),
      });
      console.log(`[task] inserted ${taskId}`);
    }
  } else {
    taskId = genTaskId();
    insertTask(inDb, {
      id: taskId,
      processAfter: new Date().toISOString(),
      recurrence: RECURRENCE,
      platformId: null,
      channelType: null,
      threadId: null,
      content: JSON.stringify({ prompt: PROMPT, script: SCRIPT }),
    });
    console.log(`[task] inserted ${taskId}`);
  }
  inDb.close();

  // Step 3: persist task id in the ledger meta table
  ledgerDb.prepare(`INSERT INTO meta(key,value) VALUES('schedule_task_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(taskId);
  ledgerDb.close();

  console.log('');
  console.log('Done.');
  console.log(`  agent_group:       ${FOLDER} (${AGENT_GROUP_ID})`);
  console.log(`  session:           ${SESSION_ID} (telegram)`);
  console.log(`  scheduled task ID: ${taskId}`);
  console.log(`  recurrence:        ${RECURRENCE}`);
  console.log(`  ledger:            ${LEDGER}`);
  console.log(`  image:             ${cfgAfter.imageTag}`);
}

main().catch((err) => {
  console.error('install-new-device-intake failed:', err);
  process.exit(1);
});
