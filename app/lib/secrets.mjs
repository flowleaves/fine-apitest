/**
 * 本地密钥存储。
 *
 * 设计取舍：这是纯本地 CLI，用户明确要求「密钥可保存，便于下次测试」。
 * 因此默认保存到 `<dataDir>/keys.json`，但：
 *  - 不写入运行报告、日志、请求快照；
 *  - 文件权限尽量设为 0600（Windows 由 ACL 决定）；
 *  - `.gitignore` 排除该文件；
 *  - 列表展示一律掩码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, maskKey, nowIso, readJson, writeJson } from './util.mjs';

export const DEFAULT_GROUP = '默认';

export function normalizeGroup(group) {
  const value = String(group ?? '').trim();
  return value || DEFAULT_GROUP;
}

export function keysFile(dataDir) {
  return path.join(dataDir, 'keys.json');
}

function emptyStore() {
  return { version: 1, keys: [] };
}

export function loadKeyStore(dataDir) {
  const file = keysFile(dataDir);
  const data = readJson(file, null);
  if (!data || typeof data !== 'object') return emptyStore();
  if (Array.isArray(data)) return { version: 1, keys: data };
  if (!Array.isArray(data.keys)) return emptyStore();
  return { version: 1, keys: data.keys.filter((item) => item && item.station && item.key) };
}

export function findKey(dataDir, station, group = DEFAULT_GROUP) {
  const name = String(station ?? '').trim();
  const grp = normalizeGroup(group);
  const store = loadKeyStore(dataDir);
  const matches = store.keys.filter(
    (item) => String(item.station).trim() === name && normalizeGroup(item.group) === grp,
  );
  if (!matches.length) return null;
  return matches[matches.length - 1];
}

export function saveKey(dataDir, { station, group = DEFAULT_GROUP, baseUrl, key }) {
  const name = String(station ?? '').trim();
  if (!name) throw new Error('保存密钥需要站点名称');
  if (!key) throw new Error('保存密钥需要 key');
  const grp = normalizeGroup(group);
  const store = loadKeyStore(dataDir);
  const entry = {
    station: name,
    group: grp,
    baseUrl: String(baseUrl ?? '').trim(),
    key: String(key),
    updatedAt: nowIso(),
  };
  const index = store.keys.findIndex(
    (item) => String(item.station).trim() === name && normalizeGroup(item.group) === grp,
  );
  if (index >= 0) store.keys[index] = entry;
  else store.keys.push(entry);

  ensureDir(dataDir);
  const file = keysFile(dataDir);
  writeJson(file, store);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows 上可能不支持 POSIX 权限，忽略
  }
  return entry;
}

export function forgetKey(dataDir, station, group = DEFAULT_GROUP) {
  const name = String(station ?? '').trim();
  const grp = normalizeGroup(group);
  const store = loadKeyStore(dataDir);
  const before = store.keys.length;
  store.keys = store.keys.filter(
    (item) => !(String(item.station).trim() === name && normalizeGroup(item.group) === grp),
  );
  writeJson(keysFile(dataDir), store);
  return before !== store.keys.length;
}

export function listKeys(dataDir) {
  return loadKeyStore(dataDir).keys.map((item) => ({
    station: item.station,
    group: normalizeGroup(item.group),
    baseUrl: item.baseUrl || '',
    keyMasked: maskKey(item.key),
    updatedAt: item.updatedAt || '',
  }));
}
