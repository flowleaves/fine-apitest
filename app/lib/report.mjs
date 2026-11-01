/**
 * 报告与索引。
 *
 * - 每次运行生成 `<run>/summary.md`；
 * - 根 `测试记录.md` 由 `data/index.json` 重新生成，保证复核后计数不漂移；
 * - 所有表格内容做 Markdown 转义。
 */
import path from 'node:path';
import {
  escapeMd,
  formatBytes,
  formatDuration,
  readJson,
  relPath,
  truncate,
  writeJson,
  writeText,
} from './util.mjs';

const OVERALL = { pass: '通过', review: '待复核', fail: '不通过' };
const STATUS = { succeeded: '成功', failed: '失败', partial: '部分成功' };
const CANDY = { correct: '正确', wrong: '错误', review: '待复核' };
const FINGERPRINT = { predicted: '有结论', insufficient: '证据不足', failed: '失败' };
const ARTIFACT = { ok: '结构通过', review: '结构待复核', fail: '不合格' };

function label(map, value, fallback = '—') {
  return map[value] || fallback;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function fmtSpeed(tps) {
  const value = Number(tps);
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toFixed(1)} t/s`;
}

function reviewSuffix(test) {
  if (!test.review) return '';
  const labelText = test.review.verdict === 'pass' ? '人工通过' : test.review.verdict === 'fail' ? '人工不通过' : '人工待定';
  return `（${labelText}）`;
}

function conclusion(test) {
  if (!test) return '—';
  if (test.status === 'failed') return '失败';
  if (test.kind === 'candy') return `${label(CANDY, test.verdict)}${test.verdict === 'correct' ? `（${test.grade?.extracted ?? '—'}）` : ''}`;
  if (test.kind === 'fingerprint') {
    if (test.verdict === 'predicted') return `有结论：${test.result?.prediction_name || test.result?.prediction || '—'}`;
    return label(FINGERPRINT, test.verdict);
  }
  return `${label(ARTIFACT, test.verdict)}${reviewSuffix(test)}`;
}

function testNote(test) {
  if (!test) return '';
  if (test.status === 'failed') return test.error?.message || '请求失败';
  if (test.kind === 'candy') {
    if (test.verdict === 'wrong') return `提取 ${test.grade?.extracted ?? '—'}，参考 ${test.grade?.reference ?? '—'}`;
    if (test.verdict === 'review') return test.grade?.reason || '需要人工查看';
    return '答案与参考答案一致';
  }
  if (test.kind === 'fingerprint') {
    if (test.verdict === 'predicted') return `家族：${test.result?.family_prediction_name || '—'} · 概率 ${((test.result?.family_probability || 0) * 100).toFixed(1)}%`;
    return test.diagnostics?.map((d) => `#${d.index + 1} ${d.parsed_numbers}/${d.minimum_numbers}`).join('，') || '有效数字不足';
  }
  if (test.verdict === 'fail') return test.reason || '产物不合格';
  return test.reason || '等待视觉复核';
}

function renderChecks(checks) {
  return (checks || [])
    .map((check) => `- [${check.ok ? 'x' : ' '}] ${check.label}${check.detail ? `：${check.detail}` : ''}`)
    .join('\n');
}

function codeBlock(text) {
  const fence = String(text).includes('```') ? '````' : '```';
  return `${fence}text\n${String(text).trim()}\n${fence}`;
}

function renderCandy(test) {
  if (!test) return '';
  const lines = ['### 糖果测试', ''];
  if (test.status === 'failed') {
    lines.push(`- 请求失败：${test.error?.message || '—'}`);
    return lines.join('\n');
  }
  lines.push(`- 结论：**${label(CANDY, test.verdict)}**`);
  lines.push(`- 提取答案：\`${test.grade?.extracted ?? '—'}\`（参考 \`${test.grade?.reference ?? '—'}\`）`);
  lines.push(`- 判分原因：\`${test.grade?.reason || '—'}\``);
  lines.push(`- 前提：${test.grade?.premiseDenied ? '明确否认' : test.grade?.premiseAccepted ? '明确接受' : '未明确表态'}`);
  if (test.answer) {
    lines.push('', '<details><summary>原始回答</summary>', '', codeBlock(test.answer), '', '</details>');
  }
  return lines.join('\n');
}

function renderFingerprint(test) {
  if (!test) return '';
  const lines = ['### 模型指纹检测', ''];
  if (test.status === 'failed') {
    lines.push(`- 请求失败：${test.error?.message || '—'}`);
    return lines.join('\n');
  }
  if (test.verdict === 'insufficient') {
    lines.push('- 结论：**证据不足**（没有足够的有效数字序列）');
    if (test.diagnostics?.length) {
      lines.push('', '| # | 期望数字 | 解析数字 | 最低要求 | 是否计入 |', '|---:|---:|---:|---:|---|');
      for (const d of test.diagnostics) {
        lines.push(`| ${d.index + 1} | ${test.samples?.[d.index]?.expectedCount ?? '—'} | ${d.parsed_numbers} | ${d.minimum_numbers} | ${d.accepted ? '是' : '否'} |`);
      }
    }
    return lines.join('\n');
  }
  const result = test.result;
  lines.push(`- 最可能模型：**${result.prediction_name || result.prediction}**（${((result.probability || 0) * 100).toFixed(1)}%）`);
  lines.push(`- 最可能家族：**${result.family_prediction_name || result.family_prediction}**（${((result.family_probability || 0) * 100).toFixed(1)}%）`);
  lines.push(`- 有效回答：${result.used_outputs} / ${test.samples?.length ?? 3}`);
  lines.push('', '| 排名 | 模型 | 概率 | 家族 |', '|---:|---|---:|---|');
  for (const [index, item] of (result.results || []).slice(0, 5).entries()) {
    lines.push(`| ${index + 1} | ${escapeMd(item.display_name || item.model)} | ${((item.probability || 0) * 100).toFixed(2)}% | ${escapeMd(item.family_name || item.family)} |`);
  }
  if (test.diagnostics?.length) {
    lines.push('', '| # | 期望数字 | 解析数字 | 最低要求 | 是否计入 |', '|---:|---:|---:|---:|---|');
    for (const d of test.diagnostics) {
      lines.push(`| ${d.index + 1} | ${test.samples?.[d.index]?.expectedCount ?? '—'} | ${d.parsed_numbers} | ${d.minimum_numbers} | ${d.accepted ? '是' : '否'} |`);
    }
  }
  const failedSamples = (test.samples || []).filter((sample) => sample.error);
  if (failedSamples.length) {
    lines.push('', '失败样本：');
    for (const sample of failedSamples) {
      lines.push(`- 第 ${sample.slot + 1} 次：${sample.error?.message || '失败'}`);
    }
  }
  return lines.join('\n');
}

function renderArtifact(test) {
  if (!test) return '';
  const lines = [`### ${test.name}`, ''];
  if (test.status === 'failed') {
    lines.push(`- 请求失败：${test.error?.message || '—'}`);
    return lines.join('\n');
  }
  lines.push(`- 结论：**${label(ARTIFACT, test.verdict)}**${reviewSuffix(test)}`);
  lines.push(`- 结构说明：${test.reason || '—'}`);
  if (test.artifactFile) {
    lines.push(`- 产物：[${path.basename(test.artifactFile)}](${test.artifactFile})（${formatBytes(test.bytes)} / ${test.lines} 行）`);
  }
  if (test.checks?.length) {
    lines.push('', renderChecks(test.checks));
  }
  if (test.review) {
    lines.push('', `**视觉复核：${label(OVERALL, test.review.verdict)}**`);
    lines.push(`- 复核人：${test.review.reviewer || '—'}`);
    lines.push(`- 时间：${fmtTime(test.review.reviewedAt)}`);
    if (test.review.note) lines.push(`- 备注：${test.review.note}`);
  }
  return lines.join('\n');
}

function renderTestTable(result) {
  const rows = [
    ['candy', '糖果测试'],
    ['fingerprint', '模型指纹检测'],
    ['capybara-html', '水豚 · 海滩骑行 HTML'],
  ];
  const lines = ['| 测试 | 请求 | 结论 | 首字 | 输出 token/s | 耗时 | 说明 |', '|---|---:|---|---:|---:|---:|---|'];
  for (const [id, name] of rows) {
    const test = result.tests?.[id];
    const status = test?.status ? label(STATUS, test.status) : '—';
    const firstContent = test?.metrics?.firstContentMs != null ? formatDuration(test.metrics.firstContentMs) : '—';
    const speed = fmtSpeed(test?.metrics?.speedTps);
    const duration = test?.metrics?.totalMs != null ? formatDuration(test.metrics.totalMs) : '—';
    const warnings = (test?.warnings || []).filter((warning) => warning !== 'non_stream');
    const note = `${testNote(test)}${warnings.length ? `；警告：${warnings.join('、')}` : ''}`;
    lines.push(`| ${name} | ${status} | ${escapeMd(conclusion(test))} | ${firstContent} | ${speed} | ${duration} | ${escapeMd(note)} |`);
  }
  return lines.join('\n');
}

function renderErrors(result) {
  const failures = [];
  for (const [id, test] of Object.entries(result.tests || {})) {
    if (test?.status === 'failed') {
      failures.push(`- **${test.name || id}**：${test.error?.message || '请求失败'}${test.httpStatus ? `（HTTP ${test.httpStatus}）` : ''}`);
    }
  }
  if (!failures.length) return '';
  return ['### 失败详情', '', ...failures].join('\n');
}

export function renderSummary(run) {
  const lines = [];
  lines.push(`# 测试报告 · ${escapeMd(run.station)}${run.group && run.group !== '默认' ? ` / ${escapeMd(run.group)}` : ''}`, '');
  lines.push('| 项 | 值 |', '|---|---|');
  lines.push(`| 运行 ID | \`${run.runId}\` |`);
  lines.push(`| 时间 | ${fmtTime(run.startedAt)} → ${fmtTime(run.finishedAt)} |`);
  lines.push(`| 站点 | ${escapeMd(run.station)} |`);
  lines.push(`| 分组 | ${escapeMd(run.group)} |`);
  lines.push(`| Base URL | ${escapeMd(run.baseUrl)} |`);
  lines.push(`| 模型数 | ${run.totals.models} |`);
  lines.push(`| 请求数 | ${run.totals.requests}（成功 ${run.totals.succeededRequests} / 失败 ${run.totals.failedRequests}） |`);
  lines.push(`| 密钥指纹 | \`${run.keyFingerprint}\` |`);
  lines.push('');

  lines.push('## 总览', '');
  lines.push('| 模型 | 糖果 | 指纹 | 水豚 HTML | 总评 |');
  lines.push('|---|---|---|---|---|');
  for (const result of run.results) {
    const tests = result.tests || {};
    lines.push(`| ${escapeMd(result.model)} | ${escapeMd(conclusion(tests.candy))} | ${escapeMd(conclusion(tests.fingerprint))} | ${escapeMd(conclusion(tests['capybara-html']))} | **${label(OVERALL, result.overall?.verdict)}** |`);
  }
  lines.push('');

  for (const result of run.results) {
    lines.push(`## ${escapeMd(result.model)}`, '');
    lines.push(`**总评：${label(OVERALL, result.overall?.verdict)}** — ${escapeMd((result.overall?.reasons || []).join('；'))}`, '');
    lines.push(renderTestTable(result), '');
    lines.push(renderCandy(result.tests?.candy), '');
    lines.push(renderFingerprint(result.tests?.fingerprint), '');
    lines.push(renderArtifact(result.tests?.['capybara-html']), '');
    const errors = renderErrors(result);
    if (errors) lines.push(errors, '');
  }

  const pending = [];
  for (const result of run.results) {
    const test = result.tests?.['capybara-html'];
    if (!test || test.status !== 'succeeded' || !test.artifactFile) continue;
    if (test.verdict === 'fail') continue;
    if (test.review?.verdict === 'pass' || test.review?.verdict === 'fail') continue;
    pending.push(`- [ ] ${escapeMd(result.model)} · ${test.name} — [${path.basename(test.artifactFile)}](${test.artifactFile})`);
  }
  if (pending.length) {
    lines.push('## 待 Agent 视觉复核', '');
    lines.push('请打开下面的 HTML，检查水豚/墨镜/自行车/海滩/海浪、速度滑块 0.3×–3.0×、暂停与继续、左上角「星芽」艺术字、移动端布局，以及动画是否连续同步，然后执行：', '');
    lines.push('```bash', 'node app/review.mjs --run <本次运行目录> --model "<模型>" --test capybara-html --verdict pass --note "..."', '```', '');
    lines.push(...pending, '');
  }

  lines.push('## 说明', '');
  lines.push('- 指纹结论只表示「数字分布最像哪个模型」，**不构成模型真假判定**；请结合供应商信息与其它证据。');
  lines.push('- artifact 的结构检查只能判断「是否完整、是否依赖外链、是否包含滑块/按钮/星芽/动画」，不能判断画得好不好；视觉质量必须人工/Agent 复核。');
  lines.push('- 请求失败会按配置自动重试；每次尝试的原始响应保存在 `responses/`，请求快照保存在 `requests/`。');
  lines.push('- 密钥不会写入本报告；只记录不可逆指纹。');
  lines.push('');

  return lines.join('\n');
}

export function renderIndex(entries) {
  const lines = [];
  lines.push('# 测试记录', '');
  lines.push('> 本文件由 `app/run.mjs` / `app/review.mjs` 自动生成，请勿手工编辑。');
  lines.push('> 人工备注请写入对应运行目录的 `summary.md` 或通过 `review.mjs --note` 记录。');
  lines.push('> 运行期只运行测试并写入本记录；修改题目/代码/判分需用户明确要求。', '');
  lines.push('| 时间 | 站点 | 分组 | 模型 | 通过 | 待复核 | 不通过 | 请求成功/失败 | 运行 ID | 报告 |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---|---|');
  const sorted = [...entries].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  for (const entry of sorted) {
    lines.push([
      fmtTime(entry.startedAt),
      escapeMd(entry.station),
      escapeMd(entry.group),
      entry.models,
      entry.pass,
      entry.review,
      entry.fail,
      `${entry.succeededRequests}/${entry.failedRequests}`,
      `\`${entry.runId}\``,
      `[打开](${entry.summaryPath})`,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  if (!sorted.length) {
    lines.push('| — | — | — | 0 | 0 | 0 | 0 | 0/0 | — | — |');
  }
  lines.push('');
  lines.push(`最近更新：${fmtTime(new Date().toISOString())}`);
  lines.push('');
  return lines.join('\n');
}

export function updateIndex({ dataDir, recordFile, run, runDir }) {
  const indexPath = path.join(dataDir, 'index.json');
  const existing = readJson(indexPath, []);
  const entries = Array.isArray(existing) ? existing : Array.isArray(existing?.runs) ? existing.runs : [];
  const recordDir = path.dirname(recordFile);
  const entry = {
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    station: run.station,
    group: run.group,
    baseUrl: run.baseUrl,
    models: run.totals.models,
    pass: run.totals.pass,
    review: run.totals.review,
    fail: run.totals.fail,
    requests: run.totals.requests,
    succeededRequests: run.totals.succeededRequests,
    failedRequests: run.totals.failedRequests,
    runPath: relPath(recordDir, runDir),
    summaryPath: relPath(recordDir, path.join(runDir, 'summary.md')),
  };
  const index = entries.findIndex((item) => item.runId === entry.runId);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  writeJson(indexPath, entries);
  writeText(recordFile, renderIndex(entries));
  return entry;
}

export function summaryStats(run) {
  return {
    runId: run.runId,
    station: run.station,
    group: run.group,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    totals: run.totals,
    models: run.results.map((result) => ({
      model: result.model,
      overall: result.overall?.verdict || 'fail',
      reasons: result.overall?.reasons || [],
    })),
  };
}
