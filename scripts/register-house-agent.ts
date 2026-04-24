/**
 * Register a separate House agent tied to the existing groups/whatsapp_house/
 * folder so the v1 flirty-vamp persona and memory stay isolated from Claw's
 * DM agent. Repoints the House messaging_group wiring at this new agent.
 */
import path from 'path';
import Database from 'better-sqlite3';

import { DATA_DIR } from '../src/config.js';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { createAgentGroup, getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { initGroupFilesystem } from '../src/group-init.js';

const FOLDER = 'whatsapp_house';
const HOUSE_WIRING_ID = 'mga-1777067071843-1r0pt0';

async function main() {
  const dbPath = path.join(DATA_DIR, 'v2.db');
  const db = initDb(dbPath);
  runMigrations(db);

  const now = new Date().toISOString();
  let ag = getAgentGroupByFolder(FOLDER);
  if (!ag) {
    const agId = 'ag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    createAgentGroup({ id: agId, name: 'House Claw', folder: FOLDER, agent_provider: null, created_at: now });
    ag = getAgentGroupByFolder(FOLDER)!;
    console.log('created agent_group', ag.id);
  } else {
    console.log('reusing agent_group', ag.id);
  }

  // Scaffold missing files — does NOT overwrite the existing v1 CLAUDE.local.md.
  initGroupFilesystem(ag);

  const rawDb = new Database(dbPath);
  const result = rawDb
    .prepare('UPDATE messaging_group_agents SET agent_group_id = ? WHERE id = ?')
    .run(ag.id, HOUSE_WIRING_ID);
  rawDb.close();
  console.log('rewired House wiring rows:', result.changes);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
