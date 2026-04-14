#!/usr/bin/env node
// claude-usage-statusline
// A Claude Code statusline that shows: model • task • dir • context bar
// and a second line with 5h / 7d API usage bars + reset countdowns.
//
// Configure via ~/.claude/settings.json:
//   { "statusLine": { "type": "command", "command": "node /path/to/statusline.js" } }

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const USAGE_CACHE_TTL_SEC = 60;

// Context window display: Claude Code reserves ~16.5% for autocompact buffer,
// so we normalize to show 100% at the usable limit, not the absolute window.
const AUTO_COMPACT_BUFFER_PCT = 16.5;

function ansi(code, text) { return `\x1b[${code}m${text}\x1b[0m`; }
function bar(pct) {
  const filled = Math.min(10, Math.max(0, Math.floor(pct / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}
function threshColor(pct) {
  if (pct < 50) return '32';          // green
  if (pct < 75) return '33';          // yellow
  if (pct < 90) return '38;5;208';    // orange
  return '31';                         // red
}
function fmtDelta(iso) {
  if (!iso) return '';
  const delta = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  if (delta < 3600) return `${Math.max(1, Math.round(delta / 60))}m`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h`;
  return `${Math.round(delta / 86400)}d`;
}

function renderContext(remaining) {
  if (remaining == null) return '';
  const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
  const color = used < 50 ? '32' : used < 65 ? '33' : used < 80 ? '38;5;208' : '5;31';
  const prefix = used >= 80 ? '💀 ' : '';
  return ' ' + ansi(color, `${prefix}${bar(used)} ${used}%`);
}

function renderUsageLine() {
  const cachePath = path.join(CLAUDE_DIR, 'cache', 'cc-usage.json');
  const refresher = path.join(__dirname, 'cc-usage-refresh.js');

  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}

  const now = Math.floor(Date.now() / 1000);
  const stale = !cache || (now - (cache.fetched_at || 0)) > USAGE_CACHE_TTL_SEC;
  if (stale && fs.existsSync(refresher)) {
    try {
      const child = spawn(process.execPath, [refresher], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch {}
  }
  if (!cache || cache.five_hour?.utilization == null) return '';

  const seg = (label, node) => {
    const pct = Math.max(0, Math.min(100, Math.round(node?.utilization ?? 0)));
    const reset = fmtDelta(node?.resets_at);
    const resetStr = reset ? ' ' + ansi('2', `resets ${reset}`) : '';
    return ansi(threshColor(pct), `${label} ${bar(pct)} ${pct}%`) + resetStr;
  };
  return '\n' + seg('5h', cache.five_hour) + ' ' + ansi('2', '│') + ' ' + seg('7d', cache.seven_day);
}

function findActiveTask(session) {
  if (!session) return '';
  const todosDir = path.join(CLAUDE_DIR, 'todos');
  if (!fs.existsSync(todosDir)) return '';
  try {
    const files = fs.readdirSync(todosDir)
      .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return '';
    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
    return todos.find(t => t.status === 'in_progress')?.activeForm || '';
  } catch { return ''; }
}

// ---- Main -----------------------------------------------------------------
let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input || '{}');
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const ctx = renderContext(data.context_window?.remaining_percentage);
    const task = findActiveTask(session);
    const usage = renderUsageLine();
    const dirname = path.basename(dir);
    const head = task
      ? `${ansi('2', model)} │ ${ansi('1', task)} │ ${ansi('2', dirname)}`
      : `${ansi('2', model)} │ ${ansi('2', dirname)}`;
    process.stdout.write(`${head}${ctx}${usage}`);
  } catch {
    // Silent fail — never break the statusline
  }
});
