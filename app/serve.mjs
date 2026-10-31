#!/usr/bin/env node
/**
 * 本地只读测试结果页。
 *
 * - 读取 data/index.json（缺失时扫描 data 目录下的 run.json）；
 * - 提供运行列表、运行详情、HTML artifact、Markdown 报告；
 * - 页面静态文件在 app/web/；
 * - 默认只绑定 127.0.0.1，不对外网开放；
 * - 不写入任何测试数据。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, safeSegment } from './lib/util.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(APP_DIR, '..');
const WEB_DIR = path.join(APP_DIR, 'web');
const VERSION = '0.2.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(status, {
    'content-type': type,
    'content-length': buffer.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  });
  res.end(buffer);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value, null, 2), 'application/json; charset=utf-8');
}

function entryFromRun(run) {
  return {
    runId: run.runId,
    station: run.station,
    group: run.group || '默认',
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    models: run.totals?.models ?? run.results?.length ?? 0,
    pass: run.totals?.pass ?? 0,
    review: run.totals?.review ?? 0,
    fail: run.totals?.fail ?? 0,
    requests: run.totals?.requests ?? 0,
    succeededRequests: run.totals?.succeededRequests ?? 0,
    failedRequests: run.totals?.failedRequests ?? 0,
  };
}

function runDirFor(dataDir, entry) {
  return path.join(dataDir, safeSegment(entry.station), safeSegment(entry.group), entry.runId);
}

function scanRuns(dataDir) {
  const out = [];
  let stations;
  try {
    stations = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const stationDir of stations) {
    if (!stationDir.isDirectory()) continue;
    const stationPath = path.join(dataDir, stationDir.name);
    let groups;
    try {
      groups = fs.readdirSync(stationPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const groupDir of groups) {
      if (!groupDir.isDirectory()) continue;
      const groupPath = path.join(stationPath, groupDir.name);
      let runs;
      try {
        runs = fs.readdirSync(groupPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const runDir of runs) {
        if (!runDir.isDirectory()) continue;
        const run = readJson(path.join(groupPath, runDir.name, 'run.json'), null);
        if (run?.runId) out.push(entryFromRun(run));
      }
    }
  }
  return out;
}

function listRuns(dataDir) {
  const indexPath = path.join(dataDir, 'index.json');
  const raw = readJson(indexPath, []);
  const indexed = Array.isArray(raw) ? raw : Array.isArray(raw?.runs) ? raw.runs : [];
  const entries = [];
  for (const item of indexed) {
    if (!item?.runId || !item?.station) continue;
    const entry = {
      runId: item.runId,
      station: item.station,
      group: item.group || '默认',
      startedAt: item.startedAt || '',
      finishedAt: item.finishedAt || '',
      models: Number(item.models || 0),
      pass: Number(item.pass || 0),
      review: Number(item.review || 0),
      fail: Number(item.fail || 0),
      requests: Number(item.requests || 0),
      succeededRequests: Number(item.succeededRequests || 0),
      failedRequests: Number(item.failedRequests || 0),
    };
    if (fs.existsSync(path.join(runDirFor(dataDir, entry), 'run.json'))) entries.push(entry);
  }
  const finalEntries = entries.length ? entries : scanRuns(dataDir);
  return finalEntries.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function loadRun(dataDir, runId) {
  const runs = listRuns(dataDir);
  const entry = runs.find((item) => item.runId === runId);
  if (!entry) return null;
  const runDir = runDirFor(dataDir, entry);
  const run = readJson(path.join(runDir, 'run.json'), null);
  if (!run) return null;
  return { entry, run, runDir };
}

function safeRunFile(runDir, relative) {
  const root = path.resolve(runDir);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export async function createResultServer({ dataDir, host = '127.0.0.1', port = 8788 } = {}) {
  const root = path.resolve(dataDir || path.join(PROJECT_ROOT, 'data'));
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, error: 'read-only server' });
      return;
    }
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      json(res, 400, { ok: false, error: 'bad url' });
      return;
    }

    try {
      if (url.pathname === '/api/runs') {
        json(res, 200, { ok: true, runs: listRuns(root), dataDir: root });
        return;
      }

      if (url.pathname === '/api/run') {
        const runId = url.searchParams.get('run') || '';
        const loaded = loadRun(root, runId);
        if (!loaded) {
          json(res, 404, { ok: false, error: 'run not found' });
          return;
        }
        json(res, 200, { ok: true, entry: loaded.entry, run: loaded.run });
        return;
      }

      if (url.pathname === '/api/artifact') {
        const runId = url.searchParams.get('run') || '';
        const model = url.searchParams.get('model') || '';
        const loaded = loadRun(root, runId);
        if (!loaded) {
          json(res, 404, { ok: false, error: 'run not found' });
          return;
        }
        const result = (loaded.run.results || []).find((item) => item.model === model);
        const artifact = result?.tests?.['capybara-html']?.artifactFile;
        if (!artifact) {
          json(res, 404, { ok: false, error: 'artifact not found' });
          return;
        }
        const file = safeRunFile(loaded.runDir, artifact);
        if (!file || !fs.existsSync(file)) {
          json(res, 404, { ok: false, error: 'artifact file missing' });
          return;
        }
        // 以 text/plain 返回，页面通过 sandbox iframe srcdoc 预览，避免同源执行。
        send(res, 200, fs.readFileSync(file, 'utf8'), 'text/plain; charset=utf-8', {
          'content-disposition': 'inline; filename="capybara.html"',
        });
        return;
      }

      if (url.pathname === '/api/report') {
        const runId = url.searchParams.get('run') || '';
        const loaded = loadRun(root, runId);
        if (!loaded) {
          json(res, 404, { ok: false, error: 'run not found' });
          return;
        }
        const file = path.join(loaded.runDir, 'summary.md');
        if (!fs.existsSync(file)) {
          json(res, 404, { ok: false, error: 'report missing' });
          return;
        }
        const download = url.searchParams.get('download') === '1';
        send(res, 200, fs.readFileSync(file, 'utf8'), 'text/markdown; charset=utf-8', download
          ? { 'content-disposition': `attachment; filename="summary-${loaded.entry.runId}.md"` }
          : { 'content-disposition': 'inline' });
        return;
      }

      if (url.pathname === '/health') {
        json(res, 200, { ok: true, version: VERSION, runs: listRuns(root).length });
        return;
      }

      // 静态文件：只允许 web/ 下的已知扩展名，避免路径穿越。
      let relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      relative = path.basename(relative);
      const file = path.join(WEB_DIR, relative);
      if (!file.startsWith(WEB_DIR + path.sep)) {
        json(res, 404, { ok: false, error: 'not found' });
        return;
      }
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
        return;
      }
      json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      json(res, 500, { ok: false, error: err?.message || 'internal error' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return {
    server,
    port: actualPort,
    url: `http://${displayHost}:${actualPort}/`,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // 打不开浏览器不影响服务
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg === '--version') {
      out.version = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (key === 'open') {
      out.open = true;
      continue;
    }
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function helpText() {
  return `fine-apitest results ${VERSION}

用法：
  node app/serve.mjs [--port 8788] [--host 127.0.0.1] [--open]
  node app/serve.mjs --data-dir "D:\\path\\to\\data" --port 8788

参数：
  --data-dir <path>   数据目录；默认 ${path.join(PROJECT_ROOT, 'data')}
  --host <host>       监听地址；默认 127.0.0.1（只本机可访问）
  --port <port>       端口；默认 8788；0 表示随机端口
  --open              启动后自动打开浏览器
  --help              显示帮助

说明：
  - 只读：页面只读取 data/，不会修改测试结果。
  - HTML 预览使用 sandbox iframe，不允许访问本页数据。
  - 默认只绑定 127.0.0.1；需要局域网访问时显式加 --host 0.0.0.0。
`;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    process.exit(0);
  }
  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }
  const dataDir = path.resolve(String(args.dataDir || path.join(PROJECT_ROOT, 'data')));
  const host = String(args.host || '127.0.0.1');
  const port = Number(args.port || 8788);
  const instance = await createResultServer({ dataDir, host, port });
  console.log(`fine-apitest 结果页：${instance.url}`);
  console.log(`数据目录：${dataDir}`);
  console.log('只读：页面只读取 data/，不会修改测试结果。');
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log('警告：当前监听非本机地址；请确认网络环境可信，并在前面加认证/反向代理。');
  }
  if (args.open) openBrowser(instance.url);
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
