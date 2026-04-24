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
 *   🧠  thinking    — emitted by src/container-runner.ts once the Docker
 *                     spawn returns (the container is about to run).
 *   🔄  working     — emitted by src/delivery.ts on the first user-facing
 *                     outbound for this wake cycle.
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

export interface ReactTarget {
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

/**
 * Per-session reaction state used by the 🧠 (thinking) and 🔄 (working)
 * lifecycle stages. The router records the target when it emits 👀; the
 * container-runner fires 🧠 after the Docker spawn returns; delivery fires
 * 🔄 on the first user-facing outbound. Container close clears both.
 *
 * Only populated when the session's messaging group is a DM — same gate
 * as the 👀 reaction. Group-chat sessions never get an entry, so the
 * helpers below no-op for them.
 */
const sessionReactionTarget = new Map<string, ReactTarget>();
const firstOutboundFired = new Set<string>();

export function setSessionReactionTarget(sessionId: string, target: ReactTarget): void {
  sessionReactionTarget.set(sessionId, target);
  firstOutboundFired.delete(sessionId);
}

export function clearSessionReactionTarget(sessionId: string): void {
  sessionReactionTarget.delete(sessionId);
  firstOutboundFired.delete(sessionId);
}

export function reactToCurrentInbound(sessionId: string, emoji: string): void {
  const target = sessionReactionTarget.get(sessionId);
  if (!target) return;
  void reactToInbound(target, emoji);
}

export function reactOnFirstOutbound(sessionId: string): void {
  if (firstOutboundFired.has(sessionId)) return;
  const target = sessionReactionTarget.get(sessionId);
  if (!target) return;
  firstOutboundFired.add(sessionId);
  void reactToInbound(target, EMOJI_WORKING);
}
