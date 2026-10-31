/**
 * 通用工具：路径安全、JSON 读写、哈希、Markdown 转义。
 * 零依赖，仅使用 Node 内置模块。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

/** 运行 ID：UTC 时间 + 6 位随机十六进制，可按时间排序且不冲突。 */
export function makeRunId(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return `${stamp}_${crypto.randomBytes(3).toString('hex')}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function shortHash(value, length = 8) {
  return sha256(value).slice(0, length);
}

/** 密钥指纹：可写入报告，不可逆推密钥。 */
export function keyFingerprint(key) {
  return `sha256:${shortHash(key, 16)}`;
}

/** 展示用掩码：保留前缀与末 4 位。 */
export function maskKey(key) {
  const text = String(key || '');
  if (!text) return '—';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

/** 把任意名称变成安全的单层目录名。 */
export function safeSegment(input, fallback = 'item') {
  let value = String(input ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\[\]()#%\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '');
  if (!value) value = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(value)) value = `_${value}`;
  if (value.length > 80) value = `${value.slice(0, 64)}-${shortHash(input, 8)}`;
  return value;
}

/** 同一批名称做安全化，并对碰撞追加短哈希。返回 Map<原名, 目录名>。 */
export function uniqueNames(values) {
  const used = new Set();
  const map = new Map();
  for (const value of values) {
    let name = safeSegment(value, 'model');
    if (used.has(name)) name = `${name}-${shortHash(value, 6)}`;
    let n = 2;
    const base = name;
    while (used.has(name)) name = `${base}-${n++}`;
    used.add(name);
    map.set(value, name);
  }
  return map;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, String(text ?? ''), 'utf8');
}

export function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function appendText(file, text) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, String(text ?? ''), 'utf8');
}

/** 相对路径统一用 /，便于 Markdown 链接跨平台。 */
export function relPath(fromDir, target) {
  return path.relative(fromDir, target).split(path.sep).join('/');
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
  const n = Number(ms);
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n % 60_000) / 1000);
  return `${m}m${s}s`;
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function escapeMd(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

export function truncate(value, length = 500) {
  const text = String(value ?? '');
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

export function parseList(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把 URL 中的敏感查询参数替换掉，用于日志兜底。 */
export function redactUrl(raw) {
  try {
    const url = new URL(String(raw));
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password|auth|sig|signature|access/i.test(key)) {
        url.searchParams.set(key, '***');
      }
    }
    return url.toString();
  } catch {
    return String(raw);
  }
}
