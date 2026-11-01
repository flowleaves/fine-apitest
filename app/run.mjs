#!/usr/bin/env node
/**
 * fine-apitest 命令行入口。
 *
 * 用法示例：
 *   node app/run.mjs --station "凉热葵" --group "默认" --url https://api.example.com/v1 --key sk-xxx
 *   node app/run.mjs --station "凉热葵" --url https://api.example.com/v1        # 复用已保存密钥
 *   node app/run.mjs --station "凉热葵" --url ... --key-env RELAY_KEY --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeRun } from './lib/runner.mjs';
import { discoverModels } from './lib/models.mjs';
import { normalizeBaseUrl } from './lib/netguard.mjs';
import { findKey, forgetKey, listKeys, normalizeGroup, saveKey } from './lib/secrets.mjs';
import { parseList } from './lib/util.mjs';
import { summaryStats } from './lib/report.mjs';
import { DEFAULT_TIMEOUTS } from './lib/chat.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(APP_DIR, '..');
const VERSION = '0.2.0';

const BOOLEAN_FLAGS = new Set([
  'help',
  'version',
  'listKeys',
  'forgetKey',
  'listModels',
  'json',
  'allowPrivate',
  'noSaveKey',
  'noRetry',
  'debug',
]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h') {
      out.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const rawKey = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    let value;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else if (BOOLEAN_FLAGS.has(key)) {
      value = true;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[++i];
    } else {
      value = true;
    }
    if (key === 'model' || key === 'models') {
      out.models = (out.models || []).concat(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function numberArg(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function helpText() {
  return `fine-apitest ${VERSION} · 模型中转站三项能力测试

用法：
  node app/run.mjs --station <站点> [--group <分组>] --url <BaseURL> --key <密钥>
  node app/run.mjs --station <站点> --url <BaseURL>              # 复用本地已保存密钥
  node app/run.mjs --station <站点> --url <BaseURL> --key-env ENV_NAME
  node app/run.mjs --list-keys
  node app/run.mjs --list-models --station <站点> --url <BaseURL>

参数：
  --station <name>        站点名称（必填；用于归档与密钥索引）
  --group <name>          分组名称（可选，默认「默认」）
  --url <baseUrl>         OpenAI 兼容 Base URL，例如 https://api.example.com/v1
  --key <key>             API Key（会保存到 data/keys.json，便于下次复用）
  --key-env <name>        从环境变量读取 API Key
  --key-file <path>       从文件读取 API Key
  --model <id[,id]>       只测指定模型；可重复，也可逗号分隔
  --concurrency <n>       并发数；默认 0 = 全并发
  --retry <n>             每个请求失败重试次数；默认 1
  --max-tokens <n>        覆盖所有测试的 max_tokens；默认不设置（不发送，交给上游）
  --timeout-connect <ms>  连接超时；默认 ${DEFAULT_TIMEOUTS.connect}
  --timeout-first <ms>    首内容超时；默认 ${DEFAULT_TIMEOUTS.first}
  --timeout-gap <ms>      内容间隔超时；默认 ${DEFAULT_TIMEOUTS.gap}
  --timeout-total <ms>    总时限；默认 ${DEFAULT_TIMEOUTS.total}
  --no-save-key           不保存本次密钥
  --no-retry              等价于 --retry 0
  --allow-private         允许私网/环回目标（仅本地 mock 测试使用）
  --json                  输出机器可读 JSON 到 stdout
  --list-keys             列出本地已保存的站点/分组（密钥掩码）
  --forget-key            删除指定站点/分组的本地密钥
  --list-models           只发现并列出模型，不跑测试
  --data-dir <path>       数据目录；默认 ${path.join(PROJECT_ROOT, 'data')}
  --log-dir <path>        日志目录；默认 ${path.join(PROJECT_ROOT, 'logs')}
  --record-file <path>    测试记录文件；默认 ${path.join(PROJECT_ROOT, '测试记录.md')}
  --bank <path>           指纹库；默认 app/data/unified_bank.json
  --debug                 出错时打印堆栈
  --help                  显示帮助

输出：
  - 每次运行一个目录：data/<站点>/<分组>/<runId>/
  - 人类可读报告：<run>/summary.md
  - 机器可读结果：<run>/run.json
  - 根索引：测试记录.md

安全：
  - 密钥默认保存到 data/keys.json（已 gitignore），不会写入报告/日志/请求快照。
  - 默认拒绝私网/环回目标；本地 mock 请加 --allow-private。
`;
}

function printKeys(dataDir) {
  const keys = listKeys(dataDir);
  if (!keys.length) {
    console.log('本地没有已保存的密钥。');
    return;
  }
  console.log('| 站点 | 分组 | Base URL | 密钥 | 更新时间 |');
  console.log('|---|---|---|---|---|');
  for (const item of keys) {
    console.log(`| ${item.station} | ${item.group} | ${item.baseUrl || '—'} | ${item.keyMasked} | ${item.updatedAt || '—'} |`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    throw new Error(`需要 Node.js >= 20，当前为 ${process.versions.node}`);
  }

  const dataDir = path.resolve(String(args.dataDir || path.join(PROJECT_ROOT, 'data')));
  const logDir = path.resolve(String(args.logDir || path.join(PROJECT_ROOT, 'logs')));
  const recordFile = path.resolve(String(args.recordFile || path.join(PROJECT_ROOT, '测试记录.md')));
  const bankPath = path.resolve(String(args.bank || path.join(APP_DIR, 'data', 'unified_bank.json')));
  const jsonMode = Boolean(args.json);

  if (args.listKeys) {
    if (jsonMode) console.log(JSON.stringify({ ok: true, keys: listKeys(dataDir) }, null, 2));
    else printKeys(dataDir);
    return;
  }

  const station = args.station && args.station !== true ? String(args.station).trim() : '';
  const group = normalizeGroup(args.group && args.group !== true ? args.group : '默认');

  if (args.forgetKey) {
    if (!station) throw new Error('--forget-key 需要同时提供 --station');
    const removed = forgetKey(dataDir, station, group);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, removed, station, group }, null, 2));
    } else {
      console.log(removed ? `已删除 ${station} / ${group} 的本地密钥。` : `没有找到 ${station} / ${group} 的本地密钥。`);
    }
    return;
  }

  if (!station) throw new Error('缺少站点名称 --station');

  const saved = findKey(dataDir, station, group);
  let url = args.url && args.url !== true ? String(args.url) : saved?.baseUrl;
  let key = args.key && args.key !== true ? String(args.key).trim() : '';

  if (!key && args.keyEnv && args.keyEnv !== true) {
    key = (process.env[String(args.keyEnv)] || '').trim();
    if (!key) throw new Error(`环境变量 ${args.keyEnv} 为空或不存在`);
  }
  if (!key && args.keyFile && args.keyFile !== true) {
    const file = path.resolve(String(args.keyFile));
    key = fs.readFileSync(file, 'utf8').trim();
    if (!key) throw new Error(`密钥文件为空：${file}`);
  }
  if (!key && saved?.key) key = String(saved.key);
  key = key.replace(/^\uFEFF/, '').trim();
  if (!key) {
    const otherGroups = [...new Set(
      listKeys(dataDir)
        .filter((item) => String(item.station).trim() === station)
        .map((item) => item.group),
    )];
    if (otherGroups.length) {
      throw new Error(`本地有 ${station} 的密钥，但分组不匹配：${otherGroups.join('、')}；请用 --group 指定。`);
    }
  }

  if (!url) throw new Error('缺少 --url（本地也没有该站点/分组的记录）');
  if (!key) throw new Error('缺少 API Key：请用 --key / --key-env / --key-file，或先保存一次');
  url = normalizeBaseUrl(url);

  if (!args.noSaveKey && (!saved || saved.key !== key || saved.baseUrl !== url)) {
    saveKey(dataDir, { station, group, baseUrl: url, key });
  }

  if (args.listModels) {
    const discovery = await discoverModels({
      baseUrl: url,
      apiKey: key,
      allowPrivate: Boolean(args.allowPrivate),
    });
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: true,
        station,
        group,
        baseUrl: url,
        models: discovery.models,
      }, null, 2));
      return;
    }
    console.log(`站点：${station} / ${group}`);
    console.log(`Base URL：${url}`);
    console.log(`模型（${discovery.models.length}）：`);
    for (const model of discovery.models) console.log(`- ${model}`);
    return;
  }

  const timeouts = {
    connect: numberArg(args.timeoutConnect, DEFAULT_TIMEOUTS.connect),
    first: numberArg(args.timeoutFirst, DEFAULT_TIMEOUTS.first),
    gap: numberArg(args.timeoutGap, DEFAULT_TIMEOUTS.gap),
    total: numberArg(args.timeoutTotal, DEFAULT_TIMEOUTS.total),
  };
  const retry = args.noRetry ? 0 : numberArg(args.retry, 1);
  const concurrency = numberArg(args.concurrency, 0);
  const maxTokens = args.maxTokens === undefined ? null : numberArg(args.maxTokens, null);

  const result = await executeRun({
    station,
    group,
    baseUrl: url,
    apiKey: key,
    models: parseList(args.models),
    concurrency,
    retry,
    maxTokens,
    timeouts,
    dataDir,
    logDir,
    recordFile,
    bankPath,
    allowPrivate: Boolean(args.allowPrivate),
    json: jsonMode,
  });

  const stats = summaryStats(result.run);
  if (jsonMode) {
    console.log(JSON.stringify({
      ok: true,
      runPath: result.runDir,
      summaryPath: result.summaryPath,
      ...stats,
    }, null, 2));
    return;
  }

  console.log('');
  console.log('完成');
  console.log(`报告：${result.summaryPath}`);
  console.log(`运行目录：${result.runDir}`);
  console.log(`模型 ${stats.totals.models} · 通过 ${stats.totals.pass} · 待复核 ${stats.totals.review} · 不通过 ${stats.totals.fail}`);
  console.log(`请求 ${stats.totals.requests}（成功 ${stats.totals.succeededRequests} / 失败 ${stats.totals.failedRequests}）`);
  if (stats.totals.review > 0) {
    console.log('');
    console.log('有 artifact 等待视觉复核：打开 summary.md 中的产物链接，复核后执行 review.mjs。');
  }
}

main().catch((err) => {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
  } else {
    console.error(`[fine-apitest] ${err.message}`);
    if (process.argv.includes('--debug')) console.error(err.stack);
  }
  process.exitCode = 1;
});
