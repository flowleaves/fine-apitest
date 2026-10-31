/**
 * 日志：同时写根日志与每次运行的日志；所有输出做密钥脱敏。
 * 进度写 stderr，保证 `--json` 的 stdout 只有机器可读结果。
 */
import path from 'node:path';
import { appendText, ensureDir, nowIso, redactUrl } from './util.mjs';

const KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

export function redact(text) {
  let out = String(text ?? '').replace(KEY_PATTERN, 'sk-***');
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***');
  out = out.replace(/([?&](?:key|token|api_key|access_token|secret)=)[^&\s]+/gi, '$1***');
  return out;
}

export class Logger {
  constructor({ files = [], quiet = false } = {}) {
    this.files = files;
    this.quiet = quiet;
    for (const file of files) ensureDir(path.dirname(file));
  }

  addFile(file) {
    if (!this.files.includes(file)) {
      this.files.push(file);
      ensureDir(path.dirname(file));
    }
  }

  write(level, message, meta) {
    let line = `[${nowIso()}] [${level}] ${redact(message)}`;
    if (meta !== undefined) {
      let serialized;
      try {
        serialized = JSON.stringify(meta);
      } catch {
        serialized = String(meta);
      }
      line += ` ${redact(serialized)}`;
    }
    for (const file of this.files) {
      try {
        appendText(file, `${line}\n`);
      } catch {
        // 日志失败不应中断测试
      }
    }
    if (!this.quiet) process.stderr.write(`${line}\n`);
  }

  info(message, meta) {
    this.write('INFO', message, meta);
  }

  warn(message, meta) {
    this.write('WARN', message, meta);
  }

  error(message, meta) {
    this.write('ERROR', message, meta);
  }

  debug(message, meta) {
    this.write('DEBUG', message, meta);
  }
}

export function logUrl(url) {
  return redactUrl(url);
}
