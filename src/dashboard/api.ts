import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { spawnSync } from 'child_process';

import Database from 'better-sqlite3';

import {
  DASHBOARD_WRITE,
  DASHBOARD_PORT,
  GROUPS_DIR,
  STORE_DIR,
} from '../config.js';
import {
  getAllChannelHealth,
  getChannelHealth,
} from '../channel-health.js';
import { CONTAINER_RUNTIME_BIN } from '../container-runtime.js';
import {
  getAllRegisteredGroups,
  getAllTasks,
  getAllSessions,
  updateTask,
} from '../db.js';
import { isValidGroupFolder } from '../group-folder.js';

// ---------- types ----------

export interface ContainerInfo {
  id: string;
  name: string;
  group: string;
  status: 'running' | 'stopped' | 'errored';
  statusRaw: string;
  uptime: string;
  cpu: string;
  mem: string;
  memPerc: string;
  image: string;
  pids: string;
  createdAt: string;
  error: string | null;
  role: string | null;
}

interface DockerPsRow {
  ID: string;
  Names: string;
  Status: string;
  State: string;
  Image: string;
  CreatedAt: string;
  RunningFor: string;
}

interface DockerStatsRow {
  ID: string;
  Name: string;
  CPUPerc: string;
  MemUsage: string;
  MemPerc: string;
  PIDs: string;
}

// ---------- read-only DB access (separate connection) ----------

let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (!_db) {
    const dbPath = path.join(STORE_DIR, 'messages.db');
    _db = new Database(dbPath, { readonly: true });
  }
  return _db;
}

// ---------- container data ----------

let statsCache: Map<string, DockerStatsRow> = new Map();
let statsCacheTime = 0;
const STATS_TTL = 8000;

function refreshStats(names: string[]): void {
  if (!names.length) return;
  const now = Date.now();
  if (now - statsCacheTime < STATS_TTL) return;
  try {
    const result = spawnSync(
      CONTAINER_RUNTIME_BIN,
      ['stats', '--no-stream', '--format', '{{json .}}', ...names],
      { encoding: 'utf8', timeout: 12000 },
    );
    if (result.status === 0 && result.stdout) {
      const newCache: Map<string, DockerStatsRow> = new Map();
      for (const line of (result.stdout as string).split('\n')) {
        const l = line.trim();
        if (!l) continue;
        try {
          const row = JSON.parse(l) as DockerStatsRow;
          newCache.set(row.ID.slice(0, 12), row);
          newCache.set(row.Name, row);
        } catch {
          /* skip malformed */
        }
      }
      statsCache = newCache;
      statsCacheTime = now;
    }
  } catch {
    /* docker unavailable */
  }
}

function inferRole(name: string): string | null {
  if (/coordinator/i.test(name)) return 'coordinator';
  const wm = name.match(/-worker[-_]?(\w+)/i);
  if (wm) return `worker-${wm[1]}`;
  if (/worker/i.test(name)) return 'worker';
  if (/code.?review/i.test(name)) return 'code-review';
  if (/test.?writer/i.test(name)) return 'test-writer';
  return null;
}

function extractGroup(name: string): string {
  const m = name.match(/^nanoclaw-(.+)-\d{10,}$/);
  return m ? m[1] : name.replace(/^nanoclaw-/, '');
}

export function getContainers(): ContainerInfo[] {
  let psRows: DockerPsRow[] = [];
  try {
    const result = spawnSync(
      CONTAINER_RUNTIME_BIN,
      ['ps', '-a', '--filter', 'name=nanoclaw-', '--format', '{{json .}}'],
      { encoding: 'utf8', timeout: 8000 },
    );
    if (result.status === 0 && result.stdout) {
      for (const line of (result.stdout as string).split('\n')) {
        const l = line.trim();
        if (!l) continue;
        try {
          psRows.push(JSON.parse(l) as DockerPsRow);
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    return [];
  }

  const runningNames = psRows
    .filter((r) => r.State === 'running')
    .map((r) => r.Names);
  refreshStats(runningNames);

  return psRows.map((row) => {
    const shortId = row.ID.slice(0, 12);
    const stats = statsCache.get(shortId) ?? statsCache.get(row.Names);
    const isRunning = row.State === 'running';
    const exitMatch = row.Status.match(/Exited \((\d+)\)/);
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
    const isErrored = !isRunning && exitCode !== null && exitCode !== 0;

    return {
      id: shortId,
      name: row.Names,
      group: extractGroup(row.Names),
      status: isRunning ? 'running' : isErrored ? 'errored' : 'stopped',
      statusRaw: row.Status,
      uptime: row.RunningFor || '-',
      cpu: stats?.CPUPerc ?? 'N/A',
      mem: stats?.MemUsage?.split('/')[0]?.trim() ?? 'N/A',
      memPerc: stats?.MemPerc ?? 'N/A',
      image: row.Image,
      pids: stats?.PIDs ?? '-',
      createdAt: row.CreatedAt,
      error: isErrored ? `Exited with code ${exitCode}` : null,
      role: inferRole(row.Names),
    };
  });
}

function containerAction(
  name: string,
  action: 'start' | 'stop' | 'restart',
): { ok: boolean; error?: string } {
  if (!/^nanoclaw-[a-zA-Z0-9_-]+-\d+$/.test(name)) {
    return { ok: false, error: 'Invalid container name' };
  }
  try {
    const result = spawnSync(CONTAINER_RUNTIME_BIN, [action, name], {
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        error: (result.stderr as string).trim() || `${action} failed`,
      };
    }
    statsCacheTime = 0;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- messages ----------

export function queryMessages(limit = 100): object[] {
  try {
    const db = getDb();
    let jidToName: Record<string, string> = {};
    try {
      const groups = getAllRegisteredGroups();
      for (const [jid, g] of Object.entries(groups)) jidToName[jid] = g.name;
    } catch {
      /* db not yet initialized — use chat names from join */
    }

    const rows = db
      .prepare(
        `SELECT m.id, m.chat_jid, m.sender_name, m.content, m.timestamp,
                m.is_from_me, m.is_bot_message, c.name as chat_name
         FROM messages m
         LEFT JOIN chats c ON c.jid = m.chat_jid
         ORDER BY m.timestamp DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      chat_jid: string;
      sender_name: string;
      content: string;
      timestamp: string;
      is_from_me: number;
      is_bot_message: number;
      chat_name: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      chatJid: r.chat_jid,
      group: jidToName[r.chat_jid] ?? r.chat_name ?? r.chat_jid,
      sender: r.sender_name,
      content: r.content.slice(0, 200),
      timestamp: r.timestamp,
      isFromMe: r.is_from_me === 1,
      isBotMessage: r.is_bot_message === 1,
    }));
  } catch {
    return [];
  }
}

// ---------- sessions ----------

export function querySessions(): object[] {
  try {
    const db = getDb();
    let sessions: Record<string, string> = {};
    let folderToName: Record<string, string> = {};
    try {
      sessions = getAllSessions();
      const groups = getAllRegisteredGroups();
      for (const [, g] of Object.entries(groups))
        folderToName[g.folder] = g.name;
    } catch {
      /* db not yet initialized */
    }

    return Object.entries(sessions).map(([folder, sessionId]) => {
      const msgCount =
        (
          db
            .prepare(
              `SELECT count(*) as cnt FROM messages m
             JOIN chats c ON c.jid = m.chat_jid
             JOIN registered_groups rg ON rg.jid = c.jid
             WHERE rg.folder = ?`,
            )
            .get(folder) as { cnt: number } | undefined
        )?.cnt ?? 0;

      const lastActivity =
        (
          db
            .prepare(
              `SELECT MAX(m.timestamp) as ts FROM messages m
             JOIN chats c ON c.jid = m.chat_jid
             JOIN registered_groups rg ON rg.jid = c.jid
             WHERE rg.folder = ?`,
            )
            .get(folder) as { ts: string | null } | undefined
        )?.ts ?? null;

      return {
        groupFolder: folder,
        groupName: folderToName[folder] ?? folder,
        sessionId: sessionId.slice(0, 16) + '…',
        messageCount: msgCount,
        lastActivity,
      };
    });
  } catch {
    return [];
  }
}

// ---------- tasks ----------

export function queryTasks(): object[] {
  try {
    const tasks = (() => {
      try {
        return getAllTasks();
      } catch {
        return [];
      }
    })();
    return tasks.map((t) => ({
      id: t.id,
      group: t.group_folder,
      prompt: t.prompt.slice(0, 120),
      scheduleType: t.schedule_type,
      scheduleValue: t.schedule_value,
      status: t.status,
      nextRun: t.next_run,
      lastRun: t.last_run,
      lastResult: t.last_result?.slice(0, 80) ?? null,
    }));
  } catch {
    return [];
  }
}

function taskAction(
  id: string,
  action: 'pause' | 'resume',
): { ok: boolean; error?: string } {
  try {
    updateTask(id, { status: action === 'pause' ? 'paused' : 'active' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- memory (CLAUDE.md) ----------

function listMemoryGroups(): string[] {
  try {
    return fs
      .readdirSync(GROUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isValidGroupFolder(d.name))
      .filter((d) => fs.existsSync(path.join(GROUPS_DIR, d.name, 'CLAUDE.md')))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function readMemory(group: string): { content: string } | { error: string } {
  if (!isValidGroupFolder(group)) return { error: 'Invalid group name' };
  const filePath = path.join(GROUPS_DIR, group, 'CLAUDE.md');
  if (!path.resolve(filePath).startsWith(path.resolve(GROUPS_DIR) + path.sep)) {
    return { error: 'Path traversal denied' };
  }
  try {
    return { content: fs.readFileSync(filePath, 'utf8') };
  } catch {
    return { error: 'File not found' };
  }
}

function writeMemory(
  group: string,
  content: string,
): { ok: boolean; error?: string } {
  if (!isValidGroupFolder(group))
    return { ok: false, error: 'Invalid group name' };
  const filePath = path.join(GROUPS_DIR, group, 'CLAUDE.md');
  if (!path.resolve(filePath).startsWith(path.resolve(GROUPS_DIR) + path.sep)) {
    return { ok: false, error: 'Path traversal denied' };
  }
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- swarm ----------

export function querySwarm(): object[] {
  const containers = getContainers().filter((c) => c.status === 'running');
  const byGroup = new Map<string, ContainerInfo[]>();
  for (const c of containers) {
    const list = byGroup.get(c.group) ?? [];
    list.push(c);
    byGroup.set(c.group, list);
  }
  const swarms: object[] = [];
  for (const [group, members] of byGroup) {
    if (members.length >= 2) {
      swarms.push({
        groupName: group,
        containers: members.map((c, i) => ({
          id: c.id,
          name: c.name,
          role: c.role ?? (i === 0 ? 'coordinator' : `worker-${i}`),
          cpu: c.cpu,
          mem: c.mem,
          status: c.status,
        })),
      });
    }
  }
  return swarms;
}

// ---------- token / cost estimates ----------

export function queryTokens(): object {
  const INPUT_COST_PER_M = 3.0;
  const OUTPUT_COST_PER_M = 15.0;
  const CHARS_PER_TOKEN = 4;
  const empty = {
    daily: [],
    byGroup: [],
    totals: {
      estimatedCost: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      dailyAverage: 0,
    },
    note: 'Data unavailable',
  };
  try {
    const db = getDb();

    const daily = db
      .prepare(
        `SELECT date(timestamp) as day,
                sum(CASE WHEN is_bot_message=0 THEN length(content) ELSE 0 END) as input_chars,
                sum(CASE WHEN is_bot_message=1 THEN length(content) ELSE 0 END) as output_chars
         FROM messages
         WHERE timestamp >= datetime('now', '-7 days')
         GROUP BY day ORDER BY day`,
      )
      .all() as Array<{
      day: string;
      input_chars: number;
      output_chars: number;
    }>;

    const dailyData = daily.map((r) => {
      const inputTok = Math.round(r.input_chars / CHARS_PER_TOKEN);
      const outputTok = Math.round(r.output_chars / CHARS_PER_TOKEN);
      const cost =
        (inputTok * INPUT_COST_PER_M + outputTok * OUTPUT_COST_PER_M) /
        1_000_000;
      return {
        date: r.day,
        inputTokens: inputTok,
        outputTokens: outputTok,
        estimatedCost: cost,
      };
    });

    const byGroupRows = db
      .prepare(
        `SELECT rg.folder, rg.name,
                sum(CASE WHEN m.is_bot_message=0 THEN length(m.content) ELSE 0 END) as input_chars,
                sum(CASE WHEN m.is_bot_message=1 THEN length(m.content) ELSE 0 END) as output_chars,
                count(*) as total_msgs
         FROM messages m
         JOIN chats c ON c.jid = m.chat_jid
         JOIN registered_groups rg ON rg.jid = c.jid
         WHERE m.timestamp >= datetime('now', '-7 days')
         GROUP BY rg.folder ORDER BY input_chars DESC`,
      )
      .all() as Array<{
      folder: string;
      name: string;
      input_chars: number;
      output_chars: number;
      total_msgs: number;
    }>;

    const totalInputTok = dailyData.reduce((s, d) => s + d.inputTokens, 0);
    const totalOutputTok = dailyData.reduce((s, d) => s + d.outputTokens, 0);
    const totalCost =
      (totalInputTok * INPUT_COST_PER_M + totalOutputTok * OUTPUT_COST_PER_M) /
      1_000_000;
    const maxChars = Math.max(
      ...byGroupRows.map((r) => r.input_chars + r.output_chars),
      1,
    );

    return {
      daily: dailyData,
      byGroup: byGroupRows.map((r) => {
        const inputTok = Math.round(r.input_chars / CHARS_PER_TOKEN);
        const outputTok = Math.round(r.output_chars / CHARS_PER_TOKEN);
        const cost =
          (inputTok * INPUT_COST_PER_M + outputTok * OUTPUT_COST_PER_M) /
          1_000_000;
        return {
          group: r.name || r.folder,
          messageCount: r.total_msgs,
          estimatedTokens: inputTok + outputTok,
          estimatedCost: cost,
          pct: Math.round(((r.input_chars + r.output_chars) / maxChars) * 100),
        };
      }),
      totals: {
        estimatedCost: totalCost,
        estimatedInputTokens: totalInputTok,
        estimatedOutputTokens: totalOutputTok,
        dailyAverage: dailyData.length ? totalCost / dailyData.length : 0,
      },
      note: 'Estimates based on character count ÷ 4. Actual billing may differ.',
    };
  } catch {
    return empty;
  }
}

// ---------- HTTP routing ----------

function jsonResp(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const method = req.method ?? 'GET';
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (method === 'GET' && seg[1] === 'config') {
    return jsonResp(res, {
      writeEnabled: DASHBOARD_WRITE,
      port: DASHBOARD_PORT,
    });
  }
  if (method === 'GET' && seg[1] === 'health' && !seg[2]) {
    const channels = getAllChannelHealth();
    const anyDegraded = channels.some((c) => c.state === 'degraded');
    return jsonResp(
      res,
      { state: anyDegraded ? 'degraded' : 'healthy', channels },
      anyDegraded ? 503 : 200,
    );
  }
  if (method === 'GET' && seg[1] === 'health' && seg[2]) {
    const channel = decodeURIComponent(seg[2]);
    const health = getChannelHealth(channel);
    if (!health) {
      return jsonResp(
        res,
        { channel, state: 'unknown', reason: 'Channel not registered' },
        404,
      );
    }
    return jsonResp(res, health, health.state === 'healthy' ? 200 : 503);
  }
  if (method === 'GET' && seg[1] === 'containers' && !seg[2]) {
    return jsonResp(res, getContainers());
  }
  if (method === 'POST' && seg[1] === 'containers' && seg[2] && seg[3]) {
    if (!DASHBOARD_WRITE)
      return jsonResp(res, { error: 'Write mode disabled' }, 403);
    const action = seg[3] as 'start' | 'stop' | 'restart';
    if (!['start', 'stop', 'restart'].includes(action)) {
      return jsonResp(res, { error: 'Unknown action' }, 400);
    }
    return jsonResp(res, containerAction(decodeURIComponent(seg[2]), action));
  }
  if (method === 'GET' && seg[1] === 'messages') {
    const limit = Math.min(
      500,
      parseInt(url.searchParams.get('limit') ?? '100', 10),
    );
    return jsonResp(res, queryMessages(limit));
  }
  if (method === 'GET' && seg[1] === 'sessions') {
    return jsonResp(res, querySessions());
  }
  if (method === 'GET' && seg[1] === 'tasks' && !seg[2]) {
    return jsonResp(res, queryTasks());
  }
  if (method === 'POST' && seg[1] === 'tasks' && seg[2] && seg[3]) {
    if (!DASHBOARD_WRITE)
      return jsonResp(res, { error: 'Write mode disabled' }, 403);
    const action = seg[3] as 'pause' | 'resume';
    if (!['pause', 'resume'].includes(action)) {
      return jsonResp(res, { error: 'Unknown action' }, 400);
    }
    return jsonResp(res, taskAction(decodeURIComponent(seg[2]), action));
  }
  if (method === 'GET' && seg[1] === 'memory' && !seg[2]) {
    return jsonResp(res, listMemoryGroups());
  }
  if (method === 'GET' && seg[1] === 'memory' && seg[2] && !seg[3]) {
    const group = decodeURIComponent(seg[2]);
    const result = readMemory(group);
    if ('error' in result) return jsonResp(res, result, 404);
    return jsonResp(res, { group, ...result });
  }
  if (method === 'PUT' && seg[1] === 'memory' && seg[2] && !seg[3]) {
    if (!DASHBOARD_WRITE)
      return jsonResp(res, { error: 'Write mode disabled' }, 403);
    const group = decodeURIComponent(seg[2]);
    try {
      const body = await readBody(req);
      const { content } = JSON.parse(body) as { content: string };
      return jsonResp(res, writeMemory(group, content));
    } catch {
      return jsonResp(res, { error: 'Invalid request body' }, 400);
    }
  }
  if (method === 'GET' && seg[1] === 'swarm') {
    return jsonResp(res, querySwarm());
  }
  if (method === 'GET' && seg[1] === 'tokens') {
    return jsonResp(res, queryTokens());
  }

  jsonResp(res, { error: 'Not found' }, 404);
}
