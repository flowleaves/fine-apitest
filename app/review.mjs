#!/usr/bin/env node
/**
 * 给 artifact 追加 Agent / 人工视觉复核结论，并重算总评。
 *
 * 用法：
 *   node app/review.mjs --run data/<站>/<组>/<runId> --model "claude-opus-5-5" \
 *     --test capybara-html --verdict pass --note "水豚、墨镜、海滩、滑块与暂停正常"
 *   node app/review.mjs --run <runDir> --list
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from './lib/log.mjs';
import { computeModelOverall, computeTotals } from './lib/overall.mjs';
import { renderSummary, updateIndex } from './lib/report.mjs';
import { nowIso, readJson, writeJson, writeText } from './lib/util.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(APP_DIR, '..');
const VERSION = '0.2.0';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const rawKey = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (eq >= 0) out[key] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function helpText() {
  return `fine-apitest review ${VERSION}

用法：
  node app/review.mjs --run <运行目录> --model <模型> --test <capybara-html> --verdict <pass|fail|review> [--note "..."]
  node app/review.mjs --run <运行目录> --list

参数：
  --run <path>        运行目录，或 run.json 路径（必填）
  --list              只列出待复核 artifact
  --model <id>        模型 ID；只有一个模型时可省略
  --test <name>       capybara-html（也接受 capybara / html）
  --verdict <value>   pass / fail / review
  --note <text>       复核备注
  --reviewer <name>   复核人，默认 agent
  --data-dir <path>   数据目录；默认由运行目录推导
  --record-file <path> 测试记录文件；默认 data 目录上一级
  --log-dir <path>    日志目录；默认 ${path.join(PROJECT_ROOT, 'logs')}
  --json              输出 JSON
  --help              显示帮助

说明：
  - 视觉复核通过可以覆盖「缺 viewport / 未检测到事件绑定 / 体积偏小」这类轻微结构警告；
  - 结构硬失败（无产物、外链、截断、缺滑块/暂停/星芽）不会被人工通过覆盖。
`;
}

function resolveRunDir(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少 --run');
  const absolute = path.resolve(raw);
  if (fs.existsSync(absolute)) {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      if (fs.existsSync(path.join(absolute, 'run.json'))) return absolute;
    } else if (path.basename(absolute) === 'run.json') {
      return path.dirname(absolute);
    }
  }
  throw new Error(`找不到运行目录或 run.json：${raw}`);
}

function normalizeTestId(value) {
  const id = String(value || '').trim();
  if (id === 'html' || id === 'capybara' || id === 'capybara-html') return 'capybara-html';
  throw new Error('--test 只支持 capybara-html（别名 capybara / html）');
}

function pending(run) {
  const out = [];
  for (const result of run.results || []) {
    const test = result.tests?.['capybara-html'];
    if (!test || test.status !== 'succeeded' || !test.artifactFile) continue;
    if (test.verdict === 'fail') continue;
    if (test.review?.verdict === 'pass' || test.review?.verdict === 'fail') continue;
    out.push({ model: result.model, test: 'capybara-html', name: test.name, artifactFile: test.artifactFile });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }
  if (!args.run || args.run === true) throw new Error('缺少 --run');

  const runDir = resolveRunDir(args.run);
  const runFile = path.join(runDir, 'run.json');
  const run = readJson(runFile, null);
  if (!run || !Array.isArray(run.results)) throw new Error(`run.json 不合法：${runFile}`);

  if (args.list) {
    const list = pending(run);
    if (args.json) {
      console.log(JSON.stringify({ ok: true, pending: list }, null, 2));
      return;
    }
    if (!list.length) {
      console.log('没有待复核的 artifact。');
      return;
    }
    console.log('| 模型 | 测试 | 测试 ID | 产物 |');
    console.log('|---|---|---|---|');
    for (const item of list) {
      console.log(`| ${item.model} | ${item.name} | ${item.test} | ${item.artifactFile} |`);
    }
    return;
  }

  const testId = normalizeTestId(args.test);
  const verdict = String(args.verdict || '').trim();
  if (!['pass', 'fail', 'review'].includes(verdict)) {
    throw new Error('--verdict 必须是 pass / fail / review');
  }

  let result;
  if (args.model && args.model !== true) {
    result = run.results.find((item) => item.model === String(args.model));
  } else if (run.results.length === 1) {
    result = run.results[0];
  }
  if (!result) {
    const models = run.results.map((item) => item.model).join('、');
    throw new Error(`找不到模型；请用 --model 指定。当前模型：${models}`);
  }

  const test = result.tests?.[testId];
  if (!test) throw new Error(`该模型没有 ${testId} 测试`);
  if (test.status !== 'succeeded') throw new Error(`${test.name} 请求失败，不能做视觉复核`);
  if (!test.artifactFile) throw new Error(`${test.name} 没有产物文件，不能做视觉复核`);

  test.review = {
    verdict,
    note: args.note && args.note !== true ? String(args.note) : '',
    reviewer: args.reviewer && args.reviewer !== true ? String(args.reviewer) : 'agent',
    reviewedAt: nowIso(),
  };
  result.overall = computeModelOverall(result.tests);
  const requestTotals = {
    requests: run.totals?.requests || 0,
    succeededRequests: run.totals?.succeededRequests || 0,
    failedRequests: run.totals?.failedRequests || 0,
  };
  run.totals = computeTotals(run.results, requestTotals);
  run.lastReviewedAt = nowIso();

  writeJson(runFile, run);
  writeText(path.join(runDir, 'summary.md'), renderSummary(run));

  const dataDir = path.resolve(String(args.dataDir || path.dirname(path.dirname(path.dirname(runDir)))));
  const recordFile = path.resolve(String(args.recordFile || path.join(path.dirname(dataDir), '测试记录.md')));
  updateIndex({ dataDir, recordFile, run, runDir });

  const logger = new Logger({
    files: [
      path.join(path.resolve(String(args.logDir || path.join(PROJECT_ROOT, 'logs'))), 'fine-apitest.log'),
      path.join(runDir, 'logs', 'run.log'),
    ],
    quiet: Boolean(args.json),
  });
  logger.info(`视觉复核：${result.model} · ${test.name} → ${verdict}`, {
    reviewer: test.review.reviewer,
    note: test.review.note,
  });

  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      runId: run.runId,
      model: result.model,
      test: testId,
      review: test.review,
      overall: result.overall,
      totals: run.totals,
    }, null, 2));
    return;
  }

  console.log(`已记录：${result.model} · ${test.name} → ${verdict}`);
  console.log(`该模型总评：${result.overall.verdict}（${result.overall.reasons.join('；')}）`);
  console.log(`报告：${path.join(runDir, 'summary.md')}`);
}

main().catch((err) => {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
  else console.error(`[fine-apitest review] ${err.message}`);
  process.exitCode = 1;
});
