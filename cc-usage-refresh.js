#!/usr/bin/env node
// Background refresher for Claude API usage (5h + 7d utilization).
// Spawned detached by statusline.js when the cache is stale. Never run inline.
//
// Writes: ~/.claude/cache/cc-usage.json
// Token sources (in order):
//   1. macOS Keychain: `security find-generic-password -s "Claude Code-credentials"`
//   2. Plaintext file: $CC_CREDENTIALS or ~/.claude/.credentials.json

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CACHE_DIR = path.join(CLAUDE_DIR, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'cc-usage.json');
const LOCK_FILE = path.join(CACHE_DIR, 'cc-usage.lock');
const CREDS_FILE = process.env.CC_CREDENTIALS || path.join(CLAUDE_DIR, '.credentials.json');

const LOCK_TTL_MS = 25_000;
const REQUEST_TIMEOUT_MS = 5000;

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (age < LOCK_TTL_MS) return false;
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch { return false; }
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

function readToken() {
  if (process.platform === 'darwin') {
    try {
      const raw = execFileSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf8', timeout: 2000 }
      ).trim();
      const tok = JSON.parse(raw)?.claudeAiOauth?.accessToken;
      if (tok) return tok;
    } catch {}
  }
  try {
    return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))?.claudeAiOauth?.accessToken || null;
  } catch { return null; }
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'GET',
      host: 'api.anthropic.com',
      path: '/api/oauth/usage',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  if (!acquireLock()) process.exit(0);
  try {
    const token = readToken();
    if (!token) throw new Error('no-token');
    const resp = await fetchUsage(token);
    const out = {
      fetched_at: Math.floor(Date.now() / 1000),
      five_hour: {
        utilization: resp?.five_hour?.utilization ?? null,
        resets_at: resp?.five_hour?.resets_at ?? null,
      },
      seven_day: {
        utilization: resp?.seven_day?.utilization ?? null,
        resets_at: resp?.seven_day?.resets_at ?? null,
      },
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
  } catch (e) {
    try {
      const prev = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
      prev.last_error = { at: Math.floor(Date.now() / 1000), msg: String(e?.message || e).slice(0, 200) };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(prev));
    } catch {}
  } finally {
    releaseLock();
  }
})();
