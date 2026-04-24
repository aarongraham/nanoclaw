/**
 * Host-side emoji reactions for message lifecycle visibility.
 *
 * This module exposes helpers the router / delivery / container-runner
 * can call to emit an emoji reaction on an inbound platform message. The
 * reactions give the user real-time feedback in the chat UI without the
 * agent having to spend tokens emitting them explicitly.
 *
 * Fire-and-forget: every helper wraps delivery errors internally — a
 * failed reaction must never break the main routing path.
 *
 * Current coverage (extend as needed):
 *   👀  received    — emitted by src/router.ts after a message is routed
 *                     and the agent is being woken.
 *   🧠  thinking    — (reserved; container-runner spawn hook).
 *   🔄  working     — (reserved; first outbound write hook).
 *   ✅  done        — agent can call `add_reaction` MCP tool explicitly.
 *   ❌  failed      — (reserved; container crash / timeout hook).
 *
 * Gate: we only react when the session is a 1-to-1 DM (is_group=0). In
 * group chats, per-message reactions from the bot on every inbound are
 * too noisy — the agent uses `add_reaction` selectively there.
 */
import { getDeliveryAdapter } from '../../delivery.js';
import { log } from '../../log.js';

export const EMOJI_RECEIVED = '\u{1F440}'; // 👀
export const EMOJI_THINKING = '\u{1F9E0}'; // 🧠
export const EMOJI_WORKING = '\u{1F504}'; // 🔄
export const EMOJI_DONE = '\u{2705}'; // ✅
export const EMOJI_FAILED = '\u{274C}'; // ❌

interface ReactTarget {
  channelType: string;
  platformId: string;
  threadId: string | null;
  messageId: string;
}

/**
 * Send an emoji reaction via the delivery adapter. No-op if no adapter
 * is registered yet or if the platform's adapter rejects the reaction.
 */
export async function reactToInbound(target: ReactTarget, emoji: string): Promise<void> {
  const adapter = getDeliveryAdapter();
  if (!adapter) return;
  try {
    await adapter.deliver(
      target.channelType,
      target.platformId,
      target.threadId,
      'chat',
      JSON.stringify({
        operation: 'reaction',
        messageId: target.messageId,
        emoji,
      }),
    );
  } catch (err) {
    log.debug('reactToInbound failed', { target, emoji, err });
  }
}
