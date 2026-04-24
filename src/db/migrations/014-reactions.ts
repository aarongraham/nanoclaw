/**
 * Emoji reactions table — stores per-message reactions from WhatsApp (or
 * any other channel that supports them). Populated by the inbound channel
 * adapter when a reaction event arrives; read by the agent (via the
 * `react_to_message` MCP tool) and by any status/history queries.
 *
 * Primary key is (message_id, message_chat_jid, reactor_jid) because a
 * single reactor can only have one reaction at a time on a given message,
 * but multiple reactors can react to the same message.
 *
 * Ported from v1's `scripts/migrate-reactions.ts`.
 */
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration014: Migration = {
  version: 14,
  name: 'reactions',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reactions (
        message_id        TEXT NOT NULL,
        message_chat_jid  TEXT NOT NULL,
        reactor_jid       TEXT NOT NULL,
        reactor_name      TEXT,
        emoji             TEXT NOT NULL,
        timestamp         TEXT NOT NULL,
        PRIMARY KEY (message_id, message_chat_jid, reactor_jid)
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_message   ON reactions(message_id, message_chat_jid);
      CREATE INDEX IF NOT EXISTS idx_reactions_reactor   ON reactions(reactor_jid);
      CREATE INDEX IF NOT EXISTS idx_reactions_emoji     ON reactions(emoji);
      CREATE INDEX IF NOT EXISTS idx_reactions_timestamp ON reactions(timestamp);
    `);
  },
};
