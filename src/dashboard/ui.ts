export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NanoClaw Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08090b;--card:#111214;--card2:#16181c;--border:#1e2028;
  --text:#e2e4ea;--muted:#6b7280;--muted2:#4b5563;
  --running:#22c55e;--stopped:#6b7280;--errored:#ef4444;
  --processing:#f59e0b;--queued:#6366f1;--swarm:#a855f7;
  --sidebar:52px;--header:52px;
  --mono:'JetBrains Mono','Cascadia Code','Fira Code',monospace;
  --sans:'DM Sans','Inter',system-ui,sans-serif;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:13px;overflow:hidden}
/* Layout */
#app{display:grid;grid-template-columns:var(--sidebar) 1fr;grid-template-rows:var(--header) 1fr;height:100vh}
.sidebar{grid-row:1/3;background:var(--card);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:6px 0;gap:2px}
.header{grid-column:2;background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:12px}
.main{grid-column:2;overflow-y:auto;padding:16px}
/* Sidebar */
.nav-btn{width:36px;height:36px;border-radius:8px;border:none;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.nav-btn:hover{background:var(--card2);color:var(--text)}
.nav-btn.active{background:#1d2535;color:#60a5fa}
.nav-btn svg{width:18px;height:18px}
/* Header */
.logo{font-family:var(--mono);font-size:14px;font-weight:500;color:var(--text);margin-right:auto;letter-spacing:-.3px}
.logo span{color:#60a5fa}
.hstat{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);padding:4px 8px;border-radius:6px;background:var(--card2)}
.hstat .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.hclock{font-family:var(--mono);font-size:12px;color:var(--muted);margin-left:4px}
/* Cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px}
.card-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:10px}
/* Summary strip */
.summary-strip{display:flex;gap:10px;margin-bottom:16px}
.sum-card{flex:1;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.sum-card .val{font-family:var(--mono);font-size:22px;font-weight:500;margin-bottom:2px}
.sum-card .lbl{font-size:11px;color:var(--muted)}
/* Container grid */
.ctr-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ctr-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px}
.ctr-card.errored{border-color:#3b1a1a}
.ctr-card.running{border-left:3px solid var(--running)}
.ctr-card.stopped{border-left:3px solid var(--stopped)}
.ctr-card.errored{border-left:3px solid var(--errored)}
.ctr-name{font-family:var(--mono);font-size:12px;font-weight:500;margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ctr-name .role-badge{font-size:10px;padding:1px 6px;border-radius:4px;background:#2a1f40;color:var(--swarm);flex-shrink:0}
.ctr-meta{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;margin-bottom:8px}
.ctr-meta .k{color:var(--muted)}
.ctr-meta .v{font-family:var(--mono);color:var(--text)}
.ctr-error{font-size:11px;color:var(--errored);background:#1f1010;border-radius:5px;padding:5px 8px;margin-bottom:8px;font-family:var(--mono)}
.ctr-actions{display:flex;gap:6px}
/* Status dot */
.status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;display:inline-block}
.status-dot.running{background:var(--running);box-shadow:0 0 0 2px #0a2012}
.status-dot.stopped{background:var(--stopped)}
.status-dot.errored{background:var(--errored);box-shadow:0 0 0 2px #2a0a0a}
.pulse{animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
/* Buttons */
.btn{padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--card2);color:var(--text);font-size:11px;cursor:pointer;font-family:var(--sans);transition:background .15s}
.btn:hover{background:#22252e}
.btn:disabled{opacity:.4;cursor:default}
.btn.danger{border-color:#3b1515;color:var(--errored)}
.btn.danger:hover{background:#1f1010}
.btn.primary{border-color:#1d3a6e;background:#1a2d4a;color:#60a5fa}
.btn.primary:hover{background:#203456}
/* Table */
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--border)}
.tbl td{padding:7px 10px;border-bottom:1px solid #16181c;font-size:12px;vertical-align:middle}
.tbl tr:hover td{background:#14161a}
/* Badges */
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:500}
.badge.running{background:#0a2012;color:var(--running)}
.badge.stopped,.badge.completed{background:#1a1b1f;color:var(--stopped)}
.badge.errored,.badge.failed{background:#2a0a0a;color:var(--errored)}
.badge.processing{background:#2a1d0a;color:var(--processing)}
.badge.queued,.badge.active{background:#1a1a30;color:var(--queued)}
.badge.paused{background:#1a1f2a;color:var(--muted)}
/* Tabs */
.tabs{display:flex;gap:2px;margin-bottom:14px;background:var(--card2);border-radius:8px;padding:3px;width:fit-content}
.tab{padding:5px 14px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;border:none;background:transparent;color:var(--muted);transition:background .15s,color .15s}
.tab.active{background:var(--card);color:var(--text)}
/* Log viewer */
.log-panel{background:#0a0b0d;border:1px solid var(--border);border-radius:8px;height:calc(100vh - 180px);overflow-y:auto;padding:10px;font-family:var(--mono);font-size:11px;line-height:1.6}
.log-line{display:flex;gap:8px;padding:1px 0}
.log-line:hover{background:#0e1015}
.log-ts{color:#3d4251;flex-shrink:0;width:80px}
.log-src{color:#4b5563;flex-shrink:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.log-lvl{flex-shrink:0;width:42px;font-weight:500}
.log-lvl.info{color:#60a5fa}
.log-lvl.warn{color:var(--processing)}
.log-lvl.error,.log-lvl.fatal{color:var(--errored)}
.log-lvl.debug{color:#4b5563}
.log-msg{color:var(--text);word-break:break-word}
.log-filters{display:flex;gap:8px;margin-bottom:10px;align-items:center}
.live-indicator{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--running)}
/* Task cards */
.task-list{display:flex;flex-direction:column;gap:8px}
.task-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;border-left-width:3px}
.task-card.active{border-left-color:var(--running)}
.task-card.paused{border-left-color:var(--muted)}
.task-card.completed{border-left-color:var(--stopped)}
.task-card.dimmed{opacity:.55}
.task-header{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px}
.task-prompt{font-size:12px;flex:1;line-height:1.5}
.task-meta{display:flex;gap:12px;font-size:11px;color:var(--muted);flex-wrap:wrap}
.task-meta span{font-family:var(--mono)}
.task-actions{display:flex;gap:6px;margin-top:8px}
/* Memory pane */
.memory-layout{display:grid;grid-template-columns:200px 1fr;gap:12px;height:calc(100vh - 150px)}
.memory-sidebar{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow-y:auto}
.memory-item{padding:9px 14px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);transition:background .12s}
.memory-item:hover{background:var(--card2)}
.memory-item.active{background:#1d2535;color:#60a5fa}
.memory-content{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.memory-content pre{font-family:var(--mono);font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-word;flex:1;color:var(--text);background:#0a0b0d;border-radius:6px;padding:12px;border:1px solid var(--border)}
.memory-content textarea{font-family:var(--mono);font-size:11px;flex:1;background:#0a0b0d;border:1px solid var(--border);border-radius:6px;padding:12px;color:var(--text);resize:none;line-height:1.7;min-height:400px}
.memory-content textarea:focus{outline:none;border-color:#2d3a55}
/* Swarm */
.swarm-empty{text-align:center;padding:60px 20px;color:var(--muted)}
.swarm-empty svg{width:48px;height:48px;opacity:.3;margin-bottom:12px}
/* Token chart */
.chart-wrap{height:160px;position:relative;margin-bottom:16px}
.chart-svg{width:100%;height:100%}
.totals-row{display:flex;gap:10px;margin-bottom:14px}
.total-card{flex:1;background:var(--card2);border-radius:8px;padding:12px}
.total-card .v{font-family:var(--mono);font-size:18px;font-weight:500;margin-bottom:2px}
.total-card .l{font-size:11px;color:var(--muted)}
.group-bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.group-bar-label{font-size:12px;width:140px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.group-bar-track{flex:1;height:6px;background:var(--card2);border-radius:3px;overflow:hidden}
.group-bar-fill{height:100%;border-radius:3px;background:var(--queued)}
.group-bar-cost{font-family:var(--mono);font-size:11px;color:var(--muted);width:60px;text-align:right;flex-shrink:0}
/* SVG Swarm */
.swarm-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px}
.swarm-title{font-size:12px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.swarm-svg{width:100%;height:220px}
/* select */
select{background:var(--card2);border:1px solid var(--border);color:var(--text);font-family:var(--sans);font-size:12px;padding:4px 8px;border-radius:6px;cursor:pointer}
select:focus{outline:none;border-color:#2d3a55}
/* Empty state */
.empty{text-align:center;padding:40px 20px;color:var(--muted);font-size:13px}
/* Scrollbar */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--muted2)}
</style>
</head>
<body>
<div id="app">
  <aside class="sidebar" id="sidebar"></aside>
  <header class="header">
    <span class="logo">Nano<span>Claw</span></span>
    <span class="hstat" id="hstat-running"><span class="dot" style="background:var(--running)"></span><span id="h-running">0</span> running</span>
    <span class="hstat" id="hstat-errored"><span class="dot" style="background:var(--errored)"></span><span id="h-errored">0</span> errored</span>
    <span class="hclock" id="hclock"></span>
  </header>
  <main class="main" id="main"></main>
</div>
<script>
(function(){
'use strict';

// ---------- state ----------
const S = {
  view: 'containers',
  writeEnabled: false,
  containers: [],
  messages: [],
  sessions: [],
  msgTab: 'messages', // 'messages' | 'sessions'
  tasks: [],
  memory: { groups: [], selected: null, content: '', editing: false, dirty: false },
  swarm: [],
  tokens: { daily: [], byGroup: [], totals: {}, note: '' },
  logs: [],
  logAutoScroll: true,
  logFilters: { source: 'all', level: 'all' },
  ws: null,
  wsConnected: false,
};

// ---------- nav ----------
const VIEWS = [
  { id: 'containers', label: 'Containers', icon: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>' },
  { id: 'queue', label: 'Message Queue', icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
  { id: 'logs', label: 'Live Logs', icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
  { id: 'tasks', label: 'Scheduled Tasks', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
  { id: 'memory', label: 'Memory Viewer', icon: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>' },
  { id: 'swarm', label: 'Agent Swarm', icon: '<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><line x1="12" y1="12" x2="5" y2="14"/><line x1="12" y1="12" x2="19" y2="14"/>' },
  { id: 'tokens', label: 'Token Tracking', icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
];

function icon(paths, extra='') {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '+extra+'>'+paths+'</svg>';
}

function buildSidebar() {
  const sb = document.getElementById('sidebar');
  sb.innerHTML = VIEWS.map(v =>
    '<button class="nav-btn'+(S.view===v.id?' active':'')+'" data-view="'+v.id+'" title="'+v.label+'">'+icon(v.icon)+'</button>'
  ).join('');
}

function setView(id) {
  S.view = id;
  buildSidebar();
  render();
  if (id === 'memory' && !S.memory.groups.length) fetchMemoryGroups();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-view]');
  if (btn) setView(btn.dataset.view);

  const act = e.target.closest('[data-action]');
  if (act) handleAction(act);
});

// ---------- clock ----------
function updateClock() {
  const now = new Date();
  const p = n => String(n).padStart(2,'0');
  document.getElementById('hclock').textContent =
    p(now.getHours())+':'+p(now.getMinutes())+':'+p(now.getSeconds());
}
setInterval(updateClock, 1000);
updateClock();

// ---------- fetch ----------
async function apiFetch(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

async function fetchContainers() {
  try {
    S.containers = await apiFetch('/api/containers');
    const running = S.containers.filter(c=>c.status==='running').length;
    const errored = S.containers.filter(c=>c.status==='errored').length;
    document.getElementById('h-running').textContent = running;
    document.getElementById('h-errored').textContent = errored;
    if (S.view === 'containers') render();
    if (S.view === 'swarm') { S.swarm = buildSwarmFromContainers(); render(); }
  } catch {}
}

async function fetchQueue() {
  try {
    const [msgs, sess] = await Promise.all([apiFetch('/api/messages?limit=100'), apiFetch('/api/sessions')]);
    S.messages = msgs; S.sessions = sess;
    if (S.view === 'queue') render();
  } catch {}
}

async function fetchTasks() {
  try {
    S.tasks = await apiFetch('/api/tasks');
    if (S.view === 'tasks') render();
  } catch {}
}

async function fetchSwarm() {
  try {
    S.swarm = await apiFetch('/api/swarm');
    if (S.view === 'swarm') render();
  } catch {}
}

async function fetchTokens() {
  try {
    S.tokens = await apiFetch('/api/tokens');
    if (S.view === 'tokens') render();
  } catch {}
}

async function fetchMemoryGroups() {
  try {
    S.memory.groups = await apiFetch('/api/memory');
    if (S.view === 'memory') render();
  } catch {}
}

async function fetchMemoryContent(group) {
  try {
    const d = await apiFetch('/api/memory/'+encodeURIComponent(group));
    S.memory.selected = group;
    S.memory.content = d.content || '';
    S.memory.editing = false;
    S.memory.dirty = false;
    if (S.view === 'memory') render();
  } catch {}
}

async function saveMemory(group, content) {
  try {
    const r = await apiFetch('/api/memory/'+encodeURIComponent(group), {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content})
    });
    if (r.ok) { S.memory.dirty = false; alert('Saved.'); }
    else alert('Save failed: '+(r.error||'unknown'));
  } catch(e) { alert('Save failed: '+e); }
}

// ---------- actions ----------
function handleAction(el) {
  const { action, id, name } = el.dataset;

  if (action === 'container-stop')    doContainerAction(name,'stop');
  if (action === 'container-start')   doContainerAction(name,'start');
  if (action === 'container-restart') doContainerAction(name,'restart');

  if (action === 'task-pause')  doTaskAction(id,'pause');
  if (action === 'task-resume') doTaskAction(id,'resume');

  if (action === 'msg-tab') { S.msgTab = id; render(); }

  if (action === 'memory-select') fetchMemoryContent(id);
  if (action === 'memory-edit') { S.memory.editing = true; render(); }
  if (action === 'memory-cancel') { S.memory.editing = false; S.memory.dirty = false; render(); }
  if (action === 'memory-save') {
    const ta = document.getElementById('memory-ta');
    if (ta) saveMemory(S.memory.selected, ta.value);
  }

  if (action === 'log-autoscroll') {
    S.logAutoScroll = !S.logAutoScroll;
    el.textContent = S.logAutoScroll ? 'Auto-scroll: on' : 'Auto-scroll: off';
  }
}

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'log-src-filter') { S.logFilters.source = el.value; renderLogs(); }
  if (el.id === 'log-lvl-filter') { S.logFilters.level = el.value; renderLogs(); }
});

async function doContainerAction(name, action) {
  if (!S.writeEnabled) return alert('Write mode disabled. Set DASHBOARD_WRITE=true.');
  const r = await apiFetch('/api/containers/'+encodeURIComponent(name)+'/'+action, {method:'POST'});
  if (!r.ok) alert(r.error || action+' failed');
  setTimeout(fetchContainers, 600);
}

async function doTaskAction(id, action) {
  if (!S.writeEnabled) return alert('Write mode disabled. Set DASHBOARD_WRITE=true.');
  await apiFetch('/api/tasks/'+encodeURIComponent(id)+'/'+action, {method:'POST'});
  fetchTasks();
}

// ---------- WebSocket ----------
function connectWs() {
  const ws = new WebSocket('ws://'+location.host+'/ws/logs');
  S.ws = ws;
  ws.onopen  = () => { S.wsConnected = true; };
  ws.onclose = () => { S.wsConnected = false; setTimeout(connectWs, 3000); };
  ws.onerror = () => ws.close();
  ws.onmessage = e => {
    try {
      const entry = JSON.parse(e.data);
      S.logs.push(entry);
      if (S.logs.length > 2000) S.logs.shift();
      if (S.view === 'logs') appendLogLine(entry);
    } catch {}
  };
}

// ---------- render helpers ----------
function statusBadge(s) {
  return '<span class="badge '+s+'">'+s+'</span>';
}

function fmtTs(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function fmtCost(c) {
  if (c == null) return '-';
  return '$'+Number(c).toFixed(4);
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '-';
  return n.toLocaleString();
}

// ---------- view renderers ----------
function render() {
  const main = document.getElementById('main');
  switch(S.view) {
    case 'containers': main.innerHTML = renderContainers(); break;
    case 'queue':      main.innerHTML = renderQueue(); break;
    case 'logs':       main.innerHTML = renderLogsView(); requestAnimationFrame(seedLogView); break;
    case 'tasks':      main.innerHTML = renderTasks(); break;
    case 'memory':     main.innerHTML = renderMemory(); break;
    case 'swarm':      main.innerHTML = renderSwarm(); break;
    case 'tokens':     main.innerHTML = renderTokens(); break;
  }
}

// --- Containers ---
function renderContainers() {
  const cs = S.containers;
  const running = cs.filter(c=>c.status==='running').length;
  const stopped = cs.filter(c=>c.status==='stopped').length;
  const errored = cs.filter(c=>c.status==='errored').length;

  const strip = '<div class="summary-strip">'+[
    ['val" style="color:var(--running)', running, 'Running'],
    ['val" style="color:var(--stopped)', stopped, 'Stopped'],
    ['val" style="color:var(--errored)', errored, 'Errored'],
    ['val', cs.length, 'Total'],
  ].map(([vc,v,l])=>'<div class="sum-card"><div class="'+vc+'">'+v+'</div><div class="lbl">'+l+'</div></div>').join('')+'</div>';

  if (!cs.length) return strip+'<div class="empty">No nanoclaw containers found.</div>';

  const cards = cs.map(c => {
    const dotCls = 'status-dot '+c.status+(c.status==='running'?' pulse':'');
    const actions = S.writeEnabled ? '<div class="ctr-actions">'+
      (c.status==='running'
        ? '<button class="btn danger" data-action="container-stop" data-name="'+esc(c.name)+'">Stop</button><button class="btn" data-action="container-restart" data-name="'+esc(c.name)+'">Restart</button>'
        : '<button class="btn primary" data-action="container-start" data-name="'+esc(c.name)+'">Start</button>'
      )+'</div>' : '';
    const roleBadge = c.role ? '<span class="role-badge">'+esc(c.role)+'</span>' : '';
    const err = c.error ? '<div class="ctr-error">'+esc(c.error)+'</div>' : '';
    return '<div class="ctr-card '+c.status+'">'+
      '<div class="ctr-name"><span class="'+dotCls+'"></span>'+esc(c.name)+roleBadge+'</div>'+
      err+
      '<div class="ctr-meta">'+
        '<span class="k">Group</span><span class="v">'+esc(c.group)+'</span>'+
        '<span class="k">Image</span><span class="v">'+esc(c.image)+'</span>'+
        '<span class="k">Uptime</span><span class="v">'+esc(c.uptime)+'</span>'+
        '<span class="k">CPU</span><span class="v">'+esc(c.cpu)+'</span>'+
        '<span class="k">Memory</span><span class="v">'+esc(c.mem)+(c.memPerc&&c.memPerc!=='N/A'?' ('+esc(c.memPerc)+')':'')+'</span>'+
        '<span class="k">PIDs</span><span class="v">'+esc(c.pids)+'</span>'+
        '<span class="k">Created</span><span class="v">'+esc(c.createdAt)+'</span>'+
      '</div>'+actions+'</div>';
  }).join('');

  return strip+'<div class="ctr-grid">'+cards+'</div>';
}

// --- Queue ---
function renderQueue() {
  const tabs = '<div class="tabs">'+
    '<button class="tab'+(S.msgTab==='messages'?' active':'')+'" data-action="msg-tab" data-id="messages">Messages</button>'+
    '<button class="tab'+(S.msgTab==='sessions'?' active':'')+'" data-action="msg-tab" data-id="sessions">Sessions</button>'+
    '</div>';

  if (S.msgTab === 'messages') {
    if (!S.messages.length) return tabs+'<div class="empty">No messages found.</div>';
    const rows = S.messages.map(m=>{
      const fromMe = m.isBotMessage ? statusBadge('completed') : (m.isFromMe ? statusBadge('processing') : '<span class="badge queued">user</span>');
      return '<tr><td>'+esc(m.group)+'</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(m.content)+'</td><td>'+esc(m.sender)+'</td><td>'+fromMe+'</td><td style="font-family:var(--mono);font-size:11px">'+fmtTs(m.timestamp)+'</td></tr>';
    }).join('');
    return tabs+'<div class="card"><table class="tbl"><thead><tr><th>Group</th><th>Content</th><th>Sender</th><th>Type</th><th>Timestamp</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  } else {
    if (!S.sessions.length) return tabs+'<div class="empty">No sessions found.</div>';
    const rows = S.sessions.map(s=>
      '<tr><td>'+esc(s.groupName)+'</td><td style="font-family:var(--mono)">'+esc(s.sessionId)+'</td><td style="font-family:var(--mono)">'+s.messageCount+'</td><td style="font-family:var(--mono);font-size:11px">'+fmtTs(s.lastActivity)+'</td></tr>'
    ).join('');
    return tabs+'<div class="card"><table class="tbl"><thead><tr><th>Group</th><th>Session ID</th><th>Messages</th><th>Last Activity</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
}

// --- Logs ---
function renderLogsView() {
  const sources = ['all', ...new Set(S.logs.map(l=>l.source))].filter(Boolean);
  const srcOpts = sources.map(s=>'<option value="'+s+'"'+(S.logFilters.source===s?' selected':'')+'>'+s+'</option>').join('');
  const lvlOpts = ['all','debug','info','warn','error','fatal'].map(l=>'<option value="'+l+'"'+(S.logFilters.level===l?' selected':'')+'>'+l+'</option>').join('');
  const wsStatus = S.wsConnected
    ? '<span class="live-indicator"><span class="live-dot pulse"></span>Live</span>'
    : '<span class="live-indicator" style="color:var(--errored)">Disconnected</span>';
  return '<div class="log-filters">'+
    '<select id="log-src-filter">'+srcOpts+'</select>'+
    '<select id="log-lvl-filter">'+lvlOpts+'</select>'+
    wsStatus+
    '<button class="btn" style="margin-left:auto" data-action="log-autoscroll">Auto-scroll: '+(S.logAutoScroll?'on':'off')+'</button>'+
    '</div>'+
    '<div class="log-panel" id="log-panel"></div>';
}

function logLineHtml(entry) {
  const { ts, level, msg, source } = entry;
  return '<div class="log-line">'+
    '<span class="log-ts">'+esc(ts||'')+'</span>'+
    '<span class="log-src" title="'+esc(source||'')+'">'+esc((source||'').split('-').slice(0,3).join('-'))+'</span>'+
    '<span class="log-lvl '+esc(level||'info')+'">'+esc((level||'info').toUpperCase().slice(0,5))+'</span>'+
    '<span class="log-msg">'+esc(msg||'')+'</span>'+
    '</div>';
}

function seedLogView() {
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  const filtered = S.logs.filter(e =>
    (S.logFilters.source === 'all' || e.source === S.logFilters.source) &&
    (S.logFilters.level === 'all' || e.level === S.logFilters.level)
  );
  panel.innerHTML = filtered.map(logLineHtml).join('');
  if (S.logAutoScroll) panel.scrollTop = panel.scrollHeight;
}

function appendLogLine(entry) {
  if (S.view !== 'logs') return;
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  if (S.logFilters.source !== 'all' && entry.source !== S.logFilters.source) return;
  if (S.logFilters.level !== 'all' && entry.level !== S.logFilters.level) return;
  const div = document.createElement('div');
  div.innerHTML = logLineHtml(entry);
  const child = div.firstChild;
  if (child) panel.appendChild(child);
  // Trim old lines to keep DOM lean
  while (panel.children.length > 1000) panel.removeChild(panel.firstChild);
  if (S.logAutoScroll) panel.scrollTop = panel.scrollHeight;
}

function renderLogs() {
  if (S.view === 'logs') seedLogView();
}

// --- Tasks ---
function renderTasks() {
  if (!S.tasks.length) return '<div class="empty">No scheduled tasks found.</div>';
  return '<div class="task-list">'+S.tasks.map(t=>{
    const isDimmed = t.status === 'paused' || t.status === 'completed';
    const actions = S.writeEnabled ? '<div class="task-actions">'+
      (t.status === 'active'
        ? '<button class="btn" data-action="task-pause" data-id="'+esc(t.id)+'">Pause</button>'
        : t.status === 'paused'
          ? '<button class="btn primary" data-action="task-resume" data-id="'+esc(t.id)+'">Resume</button>'
          : '')+'</div>' : '';
    return '<div class="task-card '+t.status+(isDimmed?' dimmed':'')+'">'+
      '<div class="task-header"><div class="task-prompt">'+esc(t.prompt)+'</div>'+statusBadge(t.status)+'</div>'+
      '<div class="task-meta">'+
        '<span>'+esc(t.group)+'</span>'+
        '<span>'+esc(t.scheduleType)+': '+esc(t.scheduleValue)+'</span>'+
        (t.nextRun?'<span>Next: '+fmtTs(t.nextRun)+'</span>':'')+
        (t.lastRun?'<span>Last: '+fmtTs(t.lastRun)+'</span>':'')+
      '</div>'+
      (t.lastResult?'<div style="font-size:11px;color:var(--muted);margin-top:5px;font-family:var(--mono)">'+esc(t.lastResult)+'</div>':'')+
      actions+'</div>';
  }).join('')+'</div>';
}

// --- Memory ---
function renderMemory() {
  const m = S.memory;
  const groups = m.groups.length
    ? m.groups.map(g=>'<div class="memory-item'+(g===m.selected?' active':'')+'" data-action="memory-select" data-id="'+esc(g)+'">'+esc(g)+'</div>').join('')
    : '<div style="padding:14px;color:var(--muted);font-size:12px">No CLAUDE.md files found.</div>';

  let content = '<div style="color:var(--muted);font-size:12px;padding:20px">Select a group to view its CLAUDE.md</div>';
  if (m.selected && m.content !== undefined) {
    if (m.editing) {
      content = '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">'+
        '<span style="font-size:12px;font-weight:600">'+esc(m.selected)+' / CLAUDE.md</span>'+
        '<div style="margin-left:auto;display:flex;gap:6px">'+
        '<button class="btn" data-action="memory-cancel">Cancel</button>'+
        '<button class="btn primary" data-action="memory-save">Save</button>'+
        '</div></div>'+
        '<textarea id="memory-ta" style="flex:1;min-height:480px;font-family:var(--mono);font-size:11px;background:#0a0b0d;border:1px solid var(--border);border-radius:6px;padding:12px;color:var(--text);resize:vertical;line-height:1.7;width:100%">'+esc(m.content)+'</textarea>';
    } else {
      content = '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">'+
        '<span style="font-size:12px;font-weight:600">'+esc(m.selected)+' / CLAUDE.md</span>'+
        (S.writeEnabled?'<button class="btn" style="margin-left:auto" data-action="memory-edit">Edit</button>':'')+
        '</div>'+
        '<pre>'+esc(m.content)+'</pre>';
    }
  }

  return '<div class="memory-layout">'+
    '<div class="memory-sidebar">'+groups+'</div>'+
    '<div class="memory-content">'+content+'</div>'+
    '</div>';
}

// --- Swarm ---
function buildSwarmFromContainers() {
  const byGroup = new Map();
  for (const c of S.containers) {
    if (c.status !== 'running') continue;
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  const result = [];
  for (const [group, members] of byGroup) {
    if (members.length >= 2) {
      result.push({ groupName: group, containers: members.map((c,i)=>({
        ...c, role: c.role || (i===0?'coordinator':'worker-'+i)
      }))});
    }
  }
  return result;
}

function renderSwarm() {
  const swarms = S.swarm.length ? S.swarm : buildSwarmFromContainers();
  if (!swarms.length) {
    return '<div class="swarm-empty">'+
      icon('<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><line x1="12" y1="12" x2="5" y2="14"/><line x1="12" y1="12" x2="19" y2="14"/>','width="48" height="48"')+
      '<br>No active swarms detected.<br><span style="font-size:11px">A swarm is detected when 2+ containers share the same group.</span></div>';
  }

  return swarms.map(swarm => {
    const members = swarm.containers;
    const coordinator = members.find(m=>m.role==='coordinator') || members[0];
    const workers = members.filter(m=>m!==coordinator);
    const svgH = 220;
    const svgW = 600;
    const cX = svgW/2, cY = 50;
    const wCount = workers.length || 1;
    const wSpacing = Math.min(120, (svgW-40) / wCount);
    const wStartX = svgW/2 - (wCount-1)*wSpacing/2;
    const wY = 160;

    let lines = workers.map((_,i)=>{
      const wx = wStartX + i*wSpacing;
      return '<line x1="'+cX+'" y1="'+(cY+22)+'" x2="'+wx+'" y2="'+(wY-22)+'" stroke="#2d3a55" stroke-width="1.5"/>'+
        '<circle r="4" fill="#60a5fa" opacity="0.7"><animateMotion dur="'+(1.5+i*0.3)+'s" repeatCount="indefinite" path="M'+cX+','+(cY+22)+' L'+wx+','+(wY-22)+'"/></circle>';
    }).join('');

    const nodeCircle = (x,y,role,cpu,mem,color) =>
      '<g transform="translate('+x+','+y+')">'+
        '<circle r="22" fill="#111214" stroke="'+color+'" stroke-width="1.5"/>'+
        '<text y="-6" text-anchor="middle" fill="'+color+'" font-size="9" font-family="JetBrains Mono,monospace" font-weight="500">'+esc(role.slice(0,10))+'</text>'+
        '<text y="5" text-anchor="middle" fill="#6b7280" font-size="8" font-family="JetBrains Mono,monospace">'+esc(cpu||'')+'</text>'+
        '<text y="15" text-anchor="middle" fill="#6b7280" font-size="8" font-family="JetBrains Mono,monospace">'+esc((mem||'').slice(0,8))+'</text>'+
      '</g>';

    const nodes = nodeCircle(cX,cY,coordinator.role||'coord',coordinator.cpu,coordinator.mem,'#a855f7')+
      workers.map((w,i)=>nodeCircle(wStartX+i*wSpacing,wY,w.role||'worker',w.cpu,w.mem,'#60a5fa')).join('');

    return '<div class="swarm-card">'+
      '<div class="swarm-title">'+icon('<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><line x1="12" y1="12" x2="5" y2="14"/><line x1="12" y1="12" x2="19" y2="14"/>')+
      esc(swarm.groupName)+' — '+members.length+' agents</div>'+
      '<svg class="swarm-svg" viewBox="0 0 '+svgW+' '+svgH+'">'+lines+nodes+'</svg>'+
      '</div>';
  }).join('');
}

// --- Tokens ---
function renderTokens() {
  const { daily, byGroup, totals, note } = S.tokens;

  const totalsHtml = '<div class="totals-row">'+[
    [fmtCost(totals.estimatedCost), 'Total Est. Cost (7d)'],
    [fmtNum(totals.estimatedInputTokens), 'Est. Input Tokens'],
    [fmtNum(totals.estimatedOutputTokens), 'Est. Output Tokens'],
    [fmtCost(totals.dailyAverage), 'Daily Average'],
  ].map(([v,l])=>'<div class="total-card"><div class="v">'+v+'</div><div class="l">'+l+'</div></div>').join('')+'</div>';

  // SVG bar chart
  let chartHtml = '<div class="card" style="margin-bottom:12px"><div class="card-title">Daily Token Usage (7 days)</div>';
  if (!daily || !daily.length) {
    chartHtml += '<div class="empty" style="padding:20px">No data</div>';
  } else {
    const maxTok = Math.max(...daily.map(d=>(d.inputTokens||0)+(d.outputTokens||0)), 1);
    const W = 560, H = 130, barW = Math.min(40, (W-40)/daily.length*0.6);
    const xStep = (W-40)/daily.length;
    const bars = daily.map((d,i)=>{
      const total = (d.inputTokens||0)+(d.outputTokens||0);
      const inH = ((d.inputTokens||0)/maxTok)*H;
      const outH = ((d.outputTokens||0)/maxTok)*H;
      const x = 20+i*xStep+xStep/2-barW/2;
      const label = (d.date||'').slice(5); // MM-DD
      return '<rect x="'+x+'" y="'+(H-inH)+'" width="'+(barW/2)+'" height="'+inH+'" fill="#6366f1" opacity="0.8" rx="2"/>'+
        '<rect x="'+(x+barW/2)+'" y="'+(H-outH)+'" width="'+(barW/2)+'" height="'+outH+'" fill="#22c55e" opacity="0.8" rx="2"/>'+
        '<text x="'+(x+barW/2)+'" y="'+(H+14)+'" text-anchor="middle" fill="#4b5563" font-size="9" font-family="JetBrains Mono,monospace">'+label+'</text>'+
        (total>0?'<text x="'+(x+barW/2)+'" y="'+(H-inH-4)+'" text-anchor="middle" fill="#9ca3af" font-size="8" font-family="JetBrains Mono,monospace">'+fmtNum(total)+'</text>':'');
    }).join('');
    const legend = '<text x="20" y="'+(H+28)+'" fill="#6366f1" font-size="9" font-family="JetBrains Mono,monospace">■ Input</text>'+
      '<text x="70" y="'+(H+28)+'" fill="#22c55e" font-size="9" font-family="JetBrains Mono,monospace">■ Output</text>';
    chartHtml += '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 '+W+' '+(H+40)+'">'+bars+legend+'</svg></div>';
  }
  chartHtml += '</div>';

  const groupBars = byGroup && byGroup.length
    ? '<div class="card"><div class="card-title">Per-Group Breakdown</div>'+
        byGroup.map(g=>'<div class="group-bar-row">'+
          '<span class="group-bar-label" title="'+esc(g.group)+'">'+esc(g.group)+'</span>'+
          '<div class="group-bar-track"><div class="group-bar-fill" style="width:'+g.pct+'%"></div></div>'+
          '<span class="group-bar-cost">'+fmtCost(g.estimatedCost)+'</span>'+
        '</div>').join('')+
      '</div>'
    : '';

  const noteHtml = note ? '<div style="font-size:11px;color:var(--muted);margin-top:8px">ℹ '+esc(note)+'</div>' : '';

  return totalsHtml+chartHtml+groupBars+noteHtml;
}

// ---------- util ----------
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- polling ----------
function pollAll() {
  fetchContainers();
  if (S.view === 'queue')  fetchQueue();
  if (S.view === 'tasks')  fetchTasks();
  if (S.view === 'swarm')  fetchSwarm();
  if (S.view === 'tokens') fetchTokens();
}

// ---------- init ----------
async function init() {
  try {
    const cfg = await apiFetch('/api/config');
    S.writeEnabled = cfg.writeEnabled || false;
  } catch {}
  buildSidebar();
  render();
  fetchContainers();
  fetchQueue();
  fetchTasks();
  fetchSwarm();
  fetchTokens();
  fetchMemoryGroups();
  connectWs();
  setInterval(pollAll, 5000);
}

init();
})();
</script>
</body>
</html>`;
}
