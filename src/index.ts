/**
 * NanoClaw — main entry point.
 *
 * Thin orchestrator: init DB, run migrations, start channel adapters,
 * start delivery polls, start sweep, handle shutdown.
 */
import path from 'path';
import type { Server } from 'http';

import { onChannelHealthChange } from './channel-health.js';
import { CREDENTIAL_PROXY_PORT, DATA_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { migrateGroupsToClaudeLocal } from './claude-md-compose.js';
import { getOwners } from './modules/permissions/db/user-roles.js';
import { ensureUserDm } from './modules/permissions/user-dm.js';
import { initDb } from './db/connection.js';
import { runMigrations } from './db/migrations/index.js';
import { ensureContainerRuntimeRunning, cleanupOrphans, PROXY_BIND_HOST } from './container-runtime.js';
import { startCredentialProxy } from './credential-proxy.js';
import { startActiveDeliveryPoll, startSweepDeliveryPoll, setDeliveryAdapter, stopDeliveryPolls } from './delivery.js';
import { startHostSweep, stopHostSweep } from './host-sweep.js';
import { routeInbound } from './router.js';
import { log } from './log.js';

// Response + shutdown registries live in response-registry.ts to break the
// circular import cycle: src/index.ts imports src/modules/index.js for side
// effects, and the modules call registerResponseHandler/onShutdown at top
// level — which would hit a TDZ error if the arrays lived here. Re-exported
// here so existing callers see the same surface.
import {
  registerResponseHandler,
  getResponseHandlers,
  onShutdown,
  getShutdownCallbacks,
  type ResponsePayload,
  type ResponseHandler,
} from './response-registry.js';
export { registerResponseHandler, onShutdown };
export type { ResponsePayload, ResponseHandler };

async function dispatchResponse(payload: ResponsePayload): Promise<void> {
  for (const handler of getResponseHandlers()) {
    try {
      const claimed = await handler(payload);
      if (claimed) return;
    } catch (err) {
      log.error('Response handler threw', { questionId: payload.questionId, err });
    }
  }
  log.warn('Unclaimed response', { questionId: payload.questionId, value: payload.value });
}

// Channel barrel — each enabled channel self-registers on import.
// Channel skills uncomment lines in channels/index.ts to enable them.
import './channels/index.js';

// Modules barrel — default modules (typing, mount-security) ship here; skills
// append registry-based modules. Imported for side effects (registrations).
import './modules/index.js';

import type { ChannelAdapter, ChannelSetup } from './channels/adapter.js';
import { initChannelAdapters, teardownChannelAdapters, getChannelAdapter } from './channels/channel-registry.js';

let proxyServer: Server | null = null;

async function main(): Promise<void> {
  log.info('NanoClaw starting');

  // 1. Init central DB
  const dbPath = path.join(DATA_DIR, 'v2.db');
  const db = initDb(dbPath);
  runMigrations(db);
  log.info('Central DB ready', { path: dbPath });

  // 1b. One-time filesystem cutover — idempotent, no-op after first run.
  migrateGroupsToClaudeLocal();

  // 2. Container runtime
  ensureContainerRuntimeRunning();
  cleanupOrphans();

  // 2b. Credential proxy — containers route Anthropic API calls here so
  // we can inject the real API key / OAuth token without ever passing it
  // into container env. See src/credential-proxy.ts.
  proxyServer = await startCredentialProxy(CREDENTIAL_PROXY_PORT, PROXY_BIND_HOST);

  // 3. Channel adapters
  await initChannelAdapters((adapter: ChannelAdapter): ChannelSetup => {
    return {
      onInbound(platformId, threadId, message) {
        routeInbound({
          channelType: adapter.channelType,
          platformId,
          threadId,
          message: {
            id: message.id,
            kind: message.kind,
            content: JSON.stringify(message.content),
            timestamp: message.timestamp,
            isMention: message.isMention,
            isGroup: message.isGroup,
          },
        }).catch((err) => {
          log.error('Failed to route inbound message', { channelType: adapter.channelType, err });
        });
      },
      onInboundEvent(event) {
        routeInbound(event).catch((err) => {
          log.error('Failed to route inbound event', {
            sourceAdapter: adapter.channelType,
            targetChannelType: event.channelType,
            err,
          });
        });
      },
      onMetadata(platformId, name, isGroup) {
        log.info('Channel metadata discovered', {
          channelType: adapter.channelType,
          platformId,
          name,
          isGroup,
        });
      },
      onAction(questionId, selectedOption, userId) {
        dispatchResponse({
          questionId,
          value: selectedOption,
          userId,
          channelType: adapter.channelType,
          // platformId/threadId aren't surfaced by the current onAction
          // signature — registered handlers look them up from the
          // pending_question / pending_approval row.
          platformId: '',
          threadId: null,
        }).catch((err) => {
          log.error('Failed to handle question response', { questionId, err });
        });
      },
    };
  });

  // 4. Delivery adapter bridge — dispatches to channel adapters
  const deliveryAdapter = {
    async deliver(
      channelType: string,
      platformId: string,
      threadId: string | null,
      kind: string,
      content: string,
      files?: import('./channels/adapter.js').OutboundFile[],
    ): Promise<string | undefined> {
      const adapter = getChannelAdapter(channelType);
      if (!adapter) {
        log.warn('No adapter for channel type', { channelType });
        return;
      }
      return adapter.deliver(platformId, threadId, { kind, content: JSON.parse(content), files });
    },
    async setTyping(channelType: string, platformId: string, threadId: string | null): Promise<void> {
      const adapter = getChannelAdapter(channelType);
      await adapter?.setTyping?.(platformId, threadId);
    },
  };
  setDeliveryAdapter(deliveryAdapter);

  // 5. Start delivery polls
  startActiveDeliveryPoll();
  startSweepDeliveryPoll();
  log.info('Delivery polls started');

  // 6. Start host sweep
  startHostSweep();
  log.info('Host sweep started');

  // 6b. Channel health — debounced alerts to the owner's DM when a
  // channel adapter stays degraded past CHANNEL_ALERT_DEBOUNCE_MS (default
  // 15min). Recovery triggers a follow-up DM only if a degraded alert was
  // already sent. See src/channel-health.ts.
  const CHANNEL_ALERT_DEBOUNCE_MS = Number(process.env.CHANNEL_ALERT_DEBOUNCE_MS) || 15 * 60 * 1000;
  const pendingDegradedAlerts = new Map<string, NodeJS.Timeout>();
  const sentDegradedAlerts = new Set<string>();

  const sendAlertToOwner = async (text: string): Promise<void> => {
    const owners = getOwners();
    if (owners.length === 0) {
      log.warn('Channel health alert: no owner configured, cannot DM', { text });
      return;
    }
    const ownerUserId = owners[0].user_id;
    const dm = await ensureUserDm(ownerUserId);
    if (!dm) {
      log.warn('Channel health alert: no DM resolved for owner', { ownerUserId, text });
      return;
    }
    const adapter = getChannelAdapter(dm.channel_type);
    if (!adapter) {
      log.warn('Channel health alert: no adapter for owner DM', { channelType: dm.channel_type, text });
      return;
    }
    try {
      await adapter.deliver(dm.platform_id, null, { kind: 'chat', content: { text } });
    } catch (err) {
      log.warn('Channel health alert: failed to DM owner', { err });
    }
  };

  onChannelHealthChange((update, previousState) => {
    const { channel, state, reason } = update;
    void previousState;
    if (state === 'degraded') {
      if (pendingDegradedAlerts.has(channel)) return;
      const timer = setTimeout(() => {
        void sendAlertToOwner(`⚠️ ${channel} degraded: ${reason ?? 'unknown'}`);
        sentDegradedAlerts.add(channel);
        pendingDegradedAlerts.delete(channel);
      }, CHANNEL_ALERT_DEBOUNCE_MS);
      pendingDegradedAlerts.set(channel, timer);
    } else if (state === 'healthy') {
      const pending = pendingDegradedAlerts.get(channel);
      if (pending) {
        clearTimeout(pending);
        pendingDegradedAlerts.delete(channel);
      }
      if (sentDegradedAlerts.has(channel)) {
        void sendAlertToOwner(`✅ ${channel} recovered`);
        sentDegradedAlerts.delete(channel);
      }
    }
  });

  // 7. Dashboard (optional — only starts if DASHBOARD_SECRET is set).
  // Reads DATA_DIR + channel registry to build a per-60s JSON snapshot
  // posted into the @nanoco/nanoclaw-dashboard server for UI display.
  const dashboardEnv = readEnvFile(['DASHBOARD_SECRET', 'DASHBOARD_PORT']);
  const dashboardSecret = process.env.DASHBOARD_SECRET || dashboardEnv.DASHBOARD_SECRET;
  const dashboardPort = parseInt(process.env.DASHBOARD_PORT || dashboardEnv.DASHBOARD_PORT || '3100', 10);
  if (dashboardSecret) {
    const { startDashboard } = await import('@nanoco/nanoclaw-dashboard');
    const { startDashboardPusher } = await import('./dashboard-pusher.js');
    startDashboard({ port: dashboardPort, secret: dashboardSecret });
    startDashboardPusher({ port: dashboardPort, secret: dashboardSecret, intervalMs: 60000 });
    log.info('Dashboard started', { port: dashboardPort });
  } else {
    log.info('Dashboard disabled (no DASHBOARD_SECRET set)');
  }

  log.info('NanoClaw running');
}

/** Graceful shutdown. */
async function shutdown(signal: string): Promise<void> {
  log.info('Shutdown signal received', { signal });
  for (const cb of getShutdownCallbacks()) {
    try {
      await cb();
    } catch (err) {
      log.error('Shutdown callback threw', { err });
    }
  }
  stopDeliveryPolls();
  stopHostSweep();
  await teardownChannelAdapters();
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  log.fatal('Startup failed', { err });
  process.exit(1);
});
