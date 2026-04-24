import { log } from './log.js';

export type HealthState = 'healthy' | 'degraded' | 'unknown';

export interface ChannelHealth {
  channel: string;
  state: HealthState;
  reason: string | null;
  since: string;
}

export type ChannelHealthListener = (current: ChannelHealth, previousState: HealthState) => void;

const state = new Map<string, ChannelHealth>();
const listeners: ChannelHealthListener[] = [];

export function setChannelHealth(channel: string, next: HealthState, reason: string | null = null): void {
  const prev = state.get(channel);
  const previousState: HealthState = prev?.state ?? 'unknown';
  if (prev && prev.state === next && prev.reason === reason) return;

  const update: ChannelHealth = {
    channel,
    state: next,
    reason,
    since: new Date().toISOString(),
  };
  state.set(channel, update);
  log.info('Channel health changed', { channel, state: next, previousState, reason });

  for (const listener of listeners) {
    try {
      listener(update, previousState);
    } catch (err) {
      log.error('Channel health listener failed', { err });
    }
  }
}

export function getChannelHealth(channel: string): ChannelHealth | null {
  return state.get(channel) ?? null;
}

export function getAllChannelHealth(): ChannelHealth[] {
  return [...state.values()];
}

export function onChannelHealthChange(listener: ChannelHealthListener): void {
  listeners.push(listener);
}
