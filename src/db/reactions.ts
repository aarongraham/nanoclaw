/**
 * Emoji reactions helpers. Reads/writes the `reactions` table created in
 * migration 014. Designed to be called from the inbound channel path
 * (when a `messages.reaction` Baileys event arrives) and from query code
 * in the agent-runner (via the `react_to_message` MCP tool and related
 * lookup helpers).
 *
 * The table is keyed on (message_id, message_chat_jid, reactor_jid).
 * Use `storeReaction` which does `INSERT OR REPLACE` — the normal case
 * is a reactor changing their emoji on the same message.
 */
import { getDb } from './connection.js';

export interface Reaction {
  message_id: string;
  message_chat_jid: string;
  reactor_jid: string;
  reactor_name?: string | null;
  emoji: string;
  timestamp: string;
}

export function storeReaction(r: Reaction): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO reactions
         (message_id, message_chat_jid, reactor_jid, reactor_name, emoji, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(r.message_id, r.message_chat_jid, r.reactor_jid, r.reactor_name ?? null, r.emoji, r.timestamp);
}

export function getReactionsForMessage(messageId: string, chatJid: string): Reaction[] {
  return getDb()
    .prepare(
      `SELECT message_id, message_chat_jid, reactor_jid, reactor_name, emoji, timestamp
         FROM reactions
        WHERE message_id = ? AND message_chat_jid = ?
        ORDER BY timestamp ASC`,
    )
    .all(messageId, chatJid) as Reaction[];
}

export function getMessagesByReaction(emoji: string, chatJid?: string): Reaction[] {
  if (chatJid) {
    return getDb()
      .prepare(
        `SELECT message_id, message_chat_jid, reactor_jid, reactor_name, emoji, timestamp
           FROM reactions
          WHERE emoji = ? AND message_chat_jid = ?
          ORDER BY timestamp DESC`,
      )
      .all(emoji, chatJid) as Reaction[];
  }
  return getDb()
    .prepare(
      `SELECT message_id, message_chat_jid, reactor_jid, reactor_name, emoji, timestamp
         FROM reactions
        WHERE emoji = ?
        ORDER BY timestamp DESC`,
    )
    .all(emoji) as Reaction[];
}

export function deleteReaction(messageId: string, chatJid: string, reactorJid: string): void {
  getDb()
    .prepare(
      `DELETE FROM reactions
        WHERE message_id = ? AND message_chat_jid = ? AND reactor_jid = ?`,
    )
    .run(messageId, chatJid, reactorJid);
}
