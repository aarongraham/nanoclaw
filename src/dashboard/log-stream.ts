import { spawn, spawnSync, ChildProcess } from 'child_process';

import { WebSocket, WebSocketServer } from 'ws';

import { CONTAINER_RUNTIME_BIN } from '../container-runtime.js';

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MAX_BUFFER = 500;

export interface LogEntry {
  ts: string;
  level: string;
  msg: string;
  source: string; // 'nanoclaw' for host process, container name for docker containers
}

const buffer: LogEntry[] = [];
const subscribers: Set<WebSocket> = new Set();
const containerProcs: Map<string, ChildProcess> = new Map();
let watchInterval: NodeJS.Timeout | null = null;

function hmsMs(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function detectLevel(line: string): string {
  const clean = line.replace(ANSI_RE, '');
  // NanoClaw logger format: [HH:MM:SS.mmm] LEVEL (pid): msg
  const m = clean.match(/\] (DEBUG|INFO|WARN|ERROR|FATAL) \(/);
  if (m) return m[1].toLowerCase();
  const u = clean.toUpperCase();
  if (u.includes('ERROR') || u.includes(' ERR ') || u.includes('[ERROR]'))
    return 'error';
  if (u.includes('WARN') || u.includes('[WARN]')) return 'warn';
  if (u.includes('DEBUG') || u.includes('[DEBUG]')) return 'debug';
  if (u.includes('FATAL')) return 'fatal';
  return 'info';
}

function pushEntry(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  const payload = JSON.stringify(entry);
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function pushLine(raw: string, source: string): void {
  const clean = raw.replace(ANSI_RE, '').trim();
  if (!clean) return;
  pushEntry({ ts: hmsMs(), level: detectLevel(raw), msg: clean, source });
}

// Intercept host-process stdout/stderr so NanoClaw's own logs appear in the viewer.
// No logger.* calls inside to avoid infinite loops.
function patchStreams(): void {
  const origOut = process.stdout.write.bind(
    process.stdout,
  ) as typeof process.stdout.write;
  const origErr = process.stderr.write.bind(
    process.stderr,
  ) as typeof process.stderr.write;

  function makeInterceptor(
    orig: typeof process.stdout.write,
    source: string,
  ): typeof process.stdout.write {
    return function (
      chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean {
      try {
        const text = Buffer.isBuffer(chunk)
          ? (chunk as Buffer).toString('utf8')
          : typeof chunk === 'string'
            ? chunk
            : '';
        for (const line of text.split('\n')) {
          pushLine(line, source);
        }
      } catch {
        // Never let log capture break normal output
      }
      if (typeof encodingOrCb === 'function') {
        return orig(chunk, encodingOrCb);
      }
      return orig(chunk, encodingOrCb as BufferEncoding, cb);
    } as typeof process.stdout.write;
  }

  process.stdout.write = makeInterceptor(origOut, 'nanoclaw');
  process.stderr.write = makeInterceptor(origErr, 'nanoclaw');
}

function listRunningNanoClawContainers(): string[] {
  try {
    const result = spawnSync(
      CONTAINER_RUNTIME_BIN,
      ['ps', '--filter', 'name=nanoclaw-', '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 5000 },
    );
    if (result.status !== 0) return [];
    return (result.stdout as string)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function startContainerLogWatch(name: string): void {
  if (containerProcs.has(name)) return;
  const proc = spawn(CONTAINER_RUNTIME_BIN, [
    'logs',
    '-f',
    '--since',
    '5m',
    name,
  ]);
  containerProcs.set(name, proc);

  const handleChunk = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split('\n')) {
      pushLine(line, name);
    }
  };

  proc.stdout.on('data', handleChunk);
  proc.stderr.on('data', handleChunk);
  proc.on('close', () => containerProcs.delete(name));
}

function updateContainerWatchers(): void {
  const running = listRunningNanoClawContainers();
  const runningSet = new Set(running);

  for (const name of running) {
    if (!containerProcs.has(name)) startContainerLogWatch(name);
  }

  for (const [name, proc] of containerProcs) {
    if (!runningSet.has(name)) {
      proc.kill();
      containerProcs.delete(name);
    }
  }
}

export function initLogStream(wss: WebSocketServer): void {
  patchStreams();
  updateContainerWatchers();
  watchInterval = setInterval(updateContainerWatchers, 30_000);

  wss.on('connection', (ws) => {
    for (const entry of buffer) {
      ws.send(JSON.stringify(entry));
    }
    subscribers.add(ws);
    ws.on('close', () => subscribers.delete(ws));
    ws.on('error', () => subscribers.delete(ws));
  });
}

export function stopLogStream(): void {
  if (watchInterval) clearInterval(watchInterval);
  for (const proc of containerProcs.values()) proc.kill();
  containerProcs.clear();
  subscribers.clear();
}
