/**
 * 目标地址校验（轻量版）。
 *
 * 这是本地 CLI，不承担多租户 SSRF 防护，但仍拒绝：
 *  - 非 http/https；
 *  - URL 内嵌用户名/密码；
 *  - 云元数据主机；
 *  - 默认拒绝环回/私网/链路本地/保留地址（本地 mock 可用 --allow-private）。
 *
 * 注意：本工具不做 DNS 固定。目标由用户自己提供，属于本地可信输入；
 * 若未来改成服务端多租户，应复用 finetest/app 的 pinnedLookup 方案。
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
  'metadata',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const IPV4_BLOCKS = [
  ['0.0.0.0', 8, 'unspecified'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrierGradeNat'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'linkLocal'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmark'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

export class TargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetError';
    this.code = code;
  }
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv4InBlock(ip, base, bits) {
  const value = ipv4ToInt(ip);
  const start = ipv4ToInt(base);
  if (value === null || start === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (start & mask);
}

function classifyIpv4(ip) {
  for (const [base, bits, reason] of IPV4_BLOCKS) {
    if (ipv4InBlock(ip, base, bits)) return { private: true, reason };
  }
  return { private: false, reason: 'public' };
}

function ipv6ToBytes(ip) {
  let text = ip.toLowerCase();
  if (text.includes('%')) text = text.split('%')[0];
  if (text === '::') return new Array(16).fill(0);

  // IPv4-mapped: ::ffff:192.0.2.1 或 ::ffff:c000:201
  const mapped = text.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (net.isIP(tail) === 4) {
      const v4 = tail.split('.').map(Number);
      return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...v4];
    }
    const hex = tail.split(':');
    if (hex.length === 2) {
      const hi = parseInt(hex[0], 16);
      const lo = parseInt(hex[1], 16);
      return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, hi >> 8, hi & 255, lo >> 8, lo & 255];
    }
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...new Array(missing).fill('0'), ...right];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const group of groups) {
    const value = parseInt(group || '0', 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 255);
  }
  return bytes;
}

function classifyIpv6(ip) {
  const bytes = ipv6ToBytes(ip);
  if (!bytes) return { private: true, reason: 'invalidIpv6' };
  const allZero = bytes.every((b) => b === 0);
  if (allZero) return { private: true, reason: 'unspecified' };
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) {
    return { private: true, reason: 'loopback' };
  }
  // IPv4-mapped（::ffff:a.b.c.d）按 IPv4 规则判断
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return classifyIpv4(v4);
  }
  // ::ffff:0:0/96 已在上方处理；这里只识别常见私网/保留段
  if ((bytes[0] & 0xfe) === 0xfc) return { private: true, reason: 'uniqueLocal' };
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return { private: true, reason: 'linkLocal' };
  if (bytes[0] === 0xff) return { private: true, reason: 'multicast' };
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return { private: true, reason: 'documentation' };
  }
  return { private: false, reason: 'public' };
}

export function classifyAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return { family, ...classifyIpv4(address) };
  if (family === 6) return { family, ...classifyIpv6(address) };
  return { family: 0, private: true, reason: 'invalid' };
}

export function normalizeBaseUrl(raw) {
  let text = String(raw ?? '').trim();
  if (!text) throw new TargetError('invalid_url', '缺少 --url');
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new TargetError('invalid_url', `URL 不合法：${text}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TargetError('invalid_url', '只支持 http/https');
  }
  if (url.username || url.password) {
    throw new TargetError('invalid_url', 'URL 不能内嵌用户名或密码；密钥请用 --key / --key-env / --key-file');
  }
  url.hash = '';
  url.search = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  pathname = pathname.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
  if (!pathname) pathname = '/v1';
  url.pathname = pathname;
  return url.toString().replace(/\/+$/, '');
}

export async function assertSafeTarget(baseUrl, { allowPrivate = false } = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (METADATA_HOSTS.has(host)) {
    throw new TargetError('metadata_blocked', `拒绝访问云元数据主机：${host}`);
  }

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch (err) {
      throw new TargetError('dns_error', `域名解析失败：${host}（${err.code || err.message}）`);
    }
  }
  if (!addresses.length) throw new TargetError('dns_error', `域名没有可用地址：${host}`);

  const blocked = [];
  for (const item of addresses) {
    const info = classifyAddress(item.address);
    if (info.private) blocked.push({ address: item.address, reason: info.reason });
  }
  if (blocked.length && !allowPrivate) {
    const detail = blocked.map((item) => `${item.address}（${item.reason}）`).join('、');
    throw new TargetError(
      'private_target',
      `目标解析到非公网地址：${detail}。如果这是本地测试服务，请加 --allow-private。`,
    );
  }
  return { url: normalized, host, addresses };
}
