/**
 * fine-apitest 结果页（零依赖 ES Module）
 *
 * - 按站点 + 分组聚合运行；
 * - 模型卡片 / 测试项可折叠；
 * - 水豚 HTML 在 sandbox iframe 中预览，可全屏；
 * - 只读：不提供任何写接口。
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TEST_META = {
  candy: { name: '糖果测试', short: '糖果', icon: '糖', cls: 'candy' },
  fingerprint: { name: '模型指纹检测', short: '指纹', icon: '纹', cls: 'fp' },
  'capybara-html': { name: '水豚 · 海滩骑行 HTML', short: 'HTML', icon: 'H', cls: 'html' },
};

const OVERALL_LABEL = { pass: '通过', review: '待复核', fail: '不通过' };
const OVERALL_CLASS = { pass: 'badge-pass', review: 'badge-review', fail: 'badge-fail' };
const DOT_CLASS = { 'badge-pass': 'dot-pass', 'badge-review': 'dot-review', 'badge-fail': 'dot-fail', 'badge-muted': 'dot-muted' };

const CHEVRON = `<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
const SUN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"></circle></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.2 8.2 0 0 1 8.8 4a8.2 8.2 0 1 0 11.2 11.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path></svg>`;

// 预览时注入 CSP：允许内联 SVG/CSS/JS，但禁止外部网络请求。
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data:;">`;

function withPreviewCsp(html) {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match, attrs) => `<head${attrs}>${PREVIEW_CSP}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, (match, attrs) => `<html${attrs}><head>${PREVIEW_CSP}</head>`);
  }
  return `${PREVIEW_CSP}${html}`;
}

const state = {
  runs: [],
  groups: [],
  dataDir: '',
  loading: true,
  error: null,
  closedGroups: new Set(),
  closedModels: new Set(),
  openedTests: new Set(),
  artifacts: new Map(),
  modal: null,
};

const runCache = new Map();

const els = {
  groups: $('#groups'),
  filterEmpty: $('#filter-empty'),
  heroStats: $('#hero-stats'),
  statGroups: $('#stat-groups'),
  statModels: $('#stat-models'),
  statPass: $('#stat-pass'),
  statReview: $('#stat-review'),
  statFail: $('#stat-fail'),
  meta: $('#result-meta'),
  search: $('#search'),
  verdictFilter: $('#verdict-filter'),
  expandBtn: $('#expand-btn'),
  collapseBtn: $('#collapse-btn'),
  refreshBtn: $('#refresh-btn'),
  themeBtn: $('#theme-btn'),
  toast: $('#toast'),
  modal: $('#modal'),
  modalTitle: $('#modal-title'),
  modalFrame: $('#modal-frame'),
  modalClose: $('#modal-close'),
  modalDownload: $('#modal-download'),
};

/* ---------------- 数据 ---------------- */

async function api(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 240) || `HTTP ${response.status}`);
  }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

async function loadRun(runId) {
  if (!runId) throw new Error('缺少 runId');
  if (runCache.has(runId)) {
    const cached = runCache.get(runId);
    if (cached.error) throw cached.error;
    return cached.data;
  }
  try {
    const data = await api(`/api/run?run=${encodeURIComponent(runId)}`);
    runCache.set(runId, { data });
    return data;
  } catch (error) {
    runCache.set(runId, { error });
    throw error;
  }
}

function buildGroups() {
  const map = new Map();
  for (const entry of state.runs) {
    const key = `${entry.station}\u0000${entry.group}`;
    if (!map.has(key)) {
      map.set(key, {
        id: `${entry.station}::${entry.group}`,
        station: entry.station,
        group: entry.group,
        runs: [],
        selectedRunId: null,
        data: null,
        error: null,
      });
    }
    map.get(key).runs.push(entry);
  }
  state.groups = [...map.values()];
  for (const group of state.groups) {
    group.runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    group.selectedRunId = group.runs[0]?.runId || null;
  }
  state.groups.sort((a, b) => String(b.runs[0]?.startedAt || '').localeCompare(String(a.runs[0]?.startedAt || '')));
}

async function loadGroup(group) {
  try {
    group.data = await loadRun(group.selectedRunId);
    group.error = null;
  } catch (error) {
    group.data = null;
    group.error = error;
  }
}

async function load({ refresh = false } = {}) {
  if (refresh) {
    runCache.clear();
    state.artifacts.clear();
  }
  state.loading = true;
  state.error = null;
  state.runs = [];
  state.groups = [];
  render();
  try {
    const data = await api('/api/runs');
    state.runs = data.runs || [];
    state.dataDir = data.dataDir || '';
    buildGroups();
    await Promise.all(state.groups.map(loadGroup));
  } catch (error) {
    state.error = error;
  } finally {
    state.loading = false;
    render();
  }
}

/* ---------------- 状态文案 ---------------- */

function statusMeta(testId, test) {
  if (!test) return { label: '缺失', cls: 'badge-muted', conclusion: '没有该测试结果' };
  if (test.status === 'failed') {
    return { label: '失败', cls: 'badge-fail', conclusion: test.error?.message || '请求失败' };
  }
  if (testId === 'candy') {
    if (test.verdict === 'correct') {
      return { label: '正确', cls: 'badge-pass', conclusion: test.grade?.extracted ? `答案 ${test.grade.extracted}` : '答案正确' };
    }
    if (test.verdict === 'wrong') {
      const extracted = test.grade?.extracted;
      const reference = test.grade?.reference;
      return { label: '错误', cls: 'badge-fail', conclusion: extracted ? `提取 ${extracted}，参考 ${reference ?? '—'}` : '答案错误' };
    }
    return { label: '待复核', cls: 'badge-review', conclusion: test.grade?.reason || '需要人工查看' };
  }
  if (testId === 'fingerprint') {
    if (test.verdict === 'predicted') {
      return { label: '有结论', cls: 'badge-pass', conclusion: test.result?.prediction_name || test.result?.prediction || '已完成归因' };
    }
    if (test.verdict === 'insufficient') {
      return { label: '证据不足', cls: 'badge-review', conclusion: '有效数字不足' };
    }
    return { label: '失败', cls: 'badge-fail', conclusion: test.error?.message || '失败' };
  }
  if (testId === 'capybara-html') {
    if (test.verdict === 'fail') return { label: '不合格', cls: 'badge-fail', conclusion: test.reason || '结构不合格' };
    if (test.review?.verdict === 'pass') return { label: '通过', cls: 'badge-pass', conclusion: '视觉复核通过' };
    if (test.review?.verdict === 'fail') return { label: '不通过', cls: 'badge-fail', conclusion: '视觉复核不通过' };
    if (test.review?.verdict === 'review') return { label: '待复核', cls: 'badge-review', conclusion: '视觉复核待定' };
    if (test.verdict === 'ok') return { label: '待复核', cls: 'badge-review', conclusion: '结构通过，待视觉复核' };
    return { label: '待复核', cls: 'badge-review', conclusion: test.reason || '结构待复核' };
  }
  return { label: '—', cls: 'badge-muted', conclusion: '' };
}

function overallBadge(verdict) {
  const value = OVERALL_LABEL[verdict] ? verdict : 'fail';
  return `<span class="badge ${OVERALL_CLASS[value]}">${OVERALL_LABEL[value]}</span>`;
}

function dotClass(badgeClass) {
  return DOT_CLASS[badgeClass] || 'dot-muted';
}

/* ---------------- 渲染 ---------------- */

function render() {
  updateStats();
  els.filterEmpty.hidden = true;
  if (state.loading) {
    els.groups.innerHTML = renderSkeleton();
    els.meta.textContent = '正在读取 data/…';
    return;
  }
  if (state.error) {
    els.groups.innerHTML = renderErrorPanel('读取测试数据失败', state.error.message, 'retry-load');
    els.meta.textContent = '读取失败';
    return;
  }
  if (!state.groups.length) {
    els.groups.innerHTML = renderEmpty();
    els.meta.textContent = '还没有测试记录';
    return;
  }
  els.groups.innerHTML = state.groups.map(renderGroup).join('');
  applyFilters();
  ensureOpenPreviews();
}

function updateStats() {
  const totals = { groups: state.groups.length, models: 0, pass: 0, review: 0, fail: 0 };
  for (const group of state.groups) {
    const entry = group.data?.entry || group.runs.find((run) => run.runId === group.selectedRunId);
    if (!entry) continue;
    totals.models += Number(entry.models || 0);
    totals.pass += Number(entry.pass || 0);
    totals.review += Number(entry.review || 0);
    totals.fail += Number(entry.fail || 0);
  }
  els.statGroups.textContent = String(totals.groups);
  els.statModels.textContent = String(totals.models);
  els.statPass.textContent = String(totals.pass);
  els.statReview.textContent = String(totals.review);
  els.statFail.textContent = String(totals.fail);
}

function renderGroup(group) {
  const entry = group.data?.entry || group.runs.find((run) => run.runId === group.selectedRunId) || group.runs[0];
  const run = group.data?.run;
  const totals = run?.totals || entry || {};
  const open = !state.closedGroups.has(group.id);

  let body;
  if (group.error) {
    body = `<div class="error-panel">${iconBlock('!')}<h3>运行详情读取失败</h3><p>${esc(group.error.message)}</p><button class="btn btn-ghost" type="button" data-action="retry-group" data-group-id="${escAttr(group.id)}">重试</button></div>`;
  } else if (!run) {
    body = `<div class="loading-panel"><div class="skeleton-line w40"></div><div class="skeleton-line w70"></div><div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div></div></div>`;
  } else if (!(run.results || []).length) {
    body = `<div class="empty"><div class="icon">✦</div><h3>本次运行没有模型结果</h3><p>检查 run.json 是否完整，或重新运行测试。</p></div>`;
  } else {
    body = `<div class="model-grid">${run.results.map((result) => renderModel(run, result)).join('')}</div>`;
  }

  const options = group.runs.map((item) => `<option value="${escAttr(item.runId)}" ${item.runId === group.selectedRunId ? 'selected' : ''}>${esc(fmtTime(item.startedAt))} · ${item.models} 模型 · 通过 ${item.pass} / 待复核 ${item.review} / 不通过 ${item.fail}</option>`).join('');

  return `<details class="group" data-group-key="${escAttr(group.id)}" ${open ? 'open' : ''}>
    <summary>
      <div class="group-title">
        <h2>${esc(group.station)} <span class="group-pill">${esc(group.group)}</span></h2>
        <div class="group-meta">
          <span>${esc(fmtTime(entry?.startedAt))}</span>
          <span>${Number(entry?.models || 0)} 个模型</span>
          <span class="mono">${esc(entry?.runId || '—')}</span>
        </div>
      </div>
      <div class="group-stats">
        <span class="mini-stat">通过 <strong>${Number(totals.pass || 0)}</strong></span>
        <span class="mini-stat">待复核 <strong>${Number(totals.review || 0)}</strong></span>
        <span class="mini-stat">不通过 <strong>${Number(totals.fail || 0)}</strong></span>
      </div>
      ${CHEVRON}
    </summary>
    <div class="group-body">
      <div class="group-controls">
        <span class="run-label">运行</span>
        <select data-run-select data-group-id="${escAttr(group.id)}" aria-label="切换运行">${options}</select>
        <a class="report-link" href="/api/report?run=${encodeURIComponent(group.selectedRunId || '')}" target="_blank" rel="noreferrer">Markdown 报告</a>
      </div>
      ${body}
    </div>
  </details>`;
}

function renderModel(run, result) {
  const tests = result.tests || {};
  const overall = result.overall || { verdict: 'fail', reasons: ['没有总评'] };
  const verdict = overall.verdict || 'fail';
  const modelKey = `${run.runId}|${result.model}`;
  const open = !state.closedModels.has(modelKey);
  const chips = Object.keys(TEST_META).map((testId) => {
    const meta = TEST_META[testId];
    const status = statusMeta(testId, tests[testId]);
    return `<span class="chip"><i class="dot ${dotClass(status.cls)}"></i>${esc(meta.short)} ${esc(status.label)}</span>`;
  }).join('');

  return `<details class="model-card" data-model-key="${escAttr(modelKey)}" data-model="${escAttr(String(result.model).toLowerCase())}" data-verdict="${escAttr(verdict)}" ${open ? 'open' : ''}>
    <summary>
      <div class="model-headline">
        <div class="model-name">${esc(result.model)}</div>
        <div class="model-sub">3 项能力测试</div>
        <div class="model-chips">${chips}</div>
      </div>
      ${overallBadge(verdict)}
      ${CHEVRON}
    </summary>
    <div class="model-body">
      <div class="overall-reasons"><strong>总评：${OVERALL_LABEL[verdict] || '不通过'}</strong> — ${esc((overall.reasons || []).join('；') || '—')}</div>
      ${renderTest(run, result, 'candy')}
      ${renderTest(run, result, 'fingerprint')}
      ${renderTest(run, result, 'capybara-html')}
    </div>
  </details>`;
}

function renderTest(run, result, testId) {
  const meta = TEST_META[testId];
  const test = result.tests?.[testId];
  const status = statusMeta(testId, test);
  const testKey = `${run.runId}|${result.model}|${testId}`;
  const open = state.openedTests.has(testKey);
  const duration = test?.metrics?.totalMs != null ? fmtDuration(test.metrics.totalMs) : '—';

  return `<details class="test" data-test-key="${escAttr(testKey)}" data-run-id="${escAttr(run.runId)}" data-model="${escAttr(result.model)}" data-test-id="${escAttr(testId)}" ${open ? 'open' : ''}>
    <summary>
      <span class="test-icon ${meta.cls}" aria-hidden="true">${esc(meta.icon)}</span>
      <span class="test-name">${esc(meta.name)}</span>
      <span class="badge ${status.cls}">${esc(status.label)}</span>
      <span class="test-conclusion">${esc(status.conclusion)}</span>
      <span class="test-duration">${duration}</span>
      ${CHEVRON}
    </summary>
    <div class="test-body">${renderTestBody(run.runId, result, testId, test)}</div>
  </details>`;
}

function renderTestBody(runId, result, testId, test) {
  if (!test) return `<div class="inline-warn">没有该测试结果。可能 run.json 来自旧版本，或本次运行被中断。</div>`;
  const common = renderCommon(test);
  if (testId === 'candy') return common + renderCandy(test);
  if (testId === 'fingerprint') return common + renderFingerprint(test);
  if (testId === 'capybara-html') return common + renderCapybara(runId, result.model, test);
  return common;
}

function renderCommon(test) {
  const rows = [
    ['请求状态', test.status === 'succeeded' ? '成功' : '失败'],
    ['HTTP', test.httpStatus ?? '—'],
    ['耗时', fmtDuration(test.metrics?.totalMs)],
    ['尝试次数', test.attempts ?? 1],
    ['finish_reason', test.finishReason ?? '—'],
    ['max_tokens', test.maxTokens ?? '—'],
  ];
  const kv = rows.map(([label, value]) => `<div class="kv"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  let html = `<div class="kv-grid">${kv}</div>`;
  if (test.error) {
    const http = test.error.httpStatus ?? test.httpStatus;
    html += `<div class="inline-error"><strong>失败：${esc(test.error.category || 'error')}</strong><br>${esc(test.error.message || '')}${http ? `<br><span class="muted">HTTP ${esc(http)}</span>` : ''}</div>`;
  }
  if ((test.warnings || []).length) {
    html += `<div class="inline-warn">警告：${esc(test.warnings.join('、'))}</div>`;
  }
  return html;
}

function renderCandy(test) {
  const grade = test.grade || {};
  const candyLabels = { correct: '正确', wrong: '错误', review: '待复核' };
  const items = [
    ['结论', candyLabels[test.verdict] || test.verdict || '—'],
    ['提取答案', grade.extracted ?? '—'],
    ['参考答案', grade.reference ?? '—'],
    ['判分原因', grade.reason ?? '—'],
    ['前提', grade.premiseDenied ? '明确否认' : grade.premiseAccepted ? '明确接受' : '未明确表态'],
    ['规则版本', grade.ruleVersion ?? '—'],
  ];
  let html = `<div class="kv-grid">${items.map(([label, value]) => `<div class="kv"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`;
  if (test.answer) {
    html += `<div class="section-title">原始回答</div><pre class="code-block">${esc(test.answer)}</pre>`;
  }
  return html + renderFiles(test);
}

function renderFingerprint(test) {
  const samples = test.samples || [];
  const diagnostics = test.diagnostics || [];
  let html = '';
  if (test.verdict === 'predicted' && test.result) {
    const result = test.result;
    const top = result.results?.[0];
    html += `<div class="prediction">
      <div>
        <div class="label">最可能模型</div>
        <div class="value">${esc(result.prediction_name || result.prediction || '—')}</div>
        <div class="label">家族 ${esc(result.family_prediction_name || result.family_prediction || '—')} · 使用 ${esc(result.used_outputs ?? '—')} 组有效回答</div>
      </div>
      <div class="prob">${fmtPercent(result.probability)}</div>
    </div>`;
    if (top) {
      html += `<div class="section-title">概率分布 · Top 5</div>${renderBars(result.results || [])}`;
      html += `<div class="section-title">候选模型</div><div class="table-wrap"><table><thead><tr><th class="num">#</th><th>模型</th><th class="num">概率</th><th>家族</th></tr></thead><tbody>${(result.results || []).slice(0, 5).map((item, index) => `<tr><td class="num">${index + 1}</td><td>${esc(item.display_name || item.model)}</td><td class="num">${fmtPercent(item.probability)}</td><td>${esc(item.family_name || item.family || '—')}</td></tr>`).join('')}</tbody></table></div>`;
    }
  } else if (test.verdict === 'insufficient') {
    html += `<div class="inline-warn">数字序列不足，无法稳定归因。可以重跑该模型，或查看下方样本诊断。</div>`;
  }
  html += renderDiagnostics(diagnostics, samples);
  html += renderSamples(samples);
  return html + renderFiles(test);
}

function renderBars(items) {
  if (!items.length) return '';
  const max = Math.max(...items.map((item) => Number(item.probability) || 0), 0.0001);
  return items.slice(0, 5).map((item) => {
    const probability = Number(item.probability) || 0;
    const width = Math.max(2, (probability / max) * 100);
    return `<div class="bar-row"><span title="${escAttr(item.model)}">${esc(item.display_name || item.model)}</span><span class="bar-track"><span class="bar-fill" style="width:${width.toFixed(1)}%"></span></span><span class="pct">${fmtPercent(probability)}</span></div>`;
  }).join('');
}

function renderDiagnostics(diagnostics, samples) {
  if (!diagnostics.length) return '';
  return `<div class="section-title">数字解析</div><div class="table-wrap"><table><thead><tr><th class="num">#</th><th class="num">期望</th><th class="num">解析</th><th class="num">最低</th><th>计入</th></tr></thead><tbody>${diagnostics.map((item, index) => {
    const sample = samples[index];
    return `<tr><td class="num">${index + 1}</td><td class="num">${esc(sample?.expectedCount ?? '—')}</td><td class="num">${esc(item.parsed_numbers)}</td><td class="num">${esc(item.minimum_numbers)}</td><td>${item.accepted ? '<span class="badge badge-pass">是</span>' : '<span class="badge badge-review">否</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderSamples(samples) {
  if (!samples.length) return '';
  const rows = samples.map((sample) => `<tr><td class="num">${sample.slot + 1}</td><td class="num">${esc(sample.expectedCount ?? '—')}</td><td class="num">${esc(sample.parsedNumbers ?? '—')}</td><td>${sample.status === 'succeeded' ? '<span class="badge badge-pass">成功</span>' : '<span class="badge badge-fail">失败</span>'}</td><td>${esc(sample.error?.message || '—')}</td></tr>`).join('');
  const previews = samples.map((sample) => `<details class="sample"><summary>样本 #${sample.slot + 1} · ${sample.status === 'succeeded' ? '成功' : '失败'}</summary><pre class="code-block">${esc(sample.answerPreview || sample.error?.message || '（无预览）')}</pre></details>`).join('');
  return `<div class="section-title">挑战样本</div><div class="table-wrap"><table><thead><tr><th class="num">#</th><th class="num">期望</th><th class="num">解析</th><th>状态</th><th>错误</th></tr></thead><tbody>${rows}</tbody></table></div>${previews}`;
}

function renderCapybara(runId, model, test) {
  let html = renderChecks(test.checks || []);
  if (test.review) {
    const verdict = test.review.verdict === 'pass' ? '通过' : test.review.verdict === 'fail' ? '不通过' : '待定';
    html += `<div class="kv-grid"><div class="kv"><span>视觉复核</span><strong>${verdict}</strong></div><div class="kv"><span>复核人</span><strong>${esc(test.review.reviewer || '—')}</strong></div><div class="kv"><span>复核时间</span><strong>${esc(fmtTime(test.review.reviewedAt))}</strong></div><div class="kv"><span>备注</span><strong>${esc(test.review.note || '—')}</strong></div></div>`;
  }
  if (test.artifactFile) {
    html += renderPreview(runId, model, test);
  } else {
    html += `<div class="inline-warn">没有可预览的 HTML 产物。${test.reason ? `结构说明：${esc(test.reason)}` : ''}</div>`;
  }
  return html + renderFiles(test);
}

function renderChecks(checks) {
  if (!checks.length) return '';
  const items = checks.map((check) => `<div class="check ${check.ok ? 'ok' : 'bad'}"><span class="mark">${check.ok ? '✓' : '!'}</span><span>${esc(check.label)}${check.critical ? '<span class="critical">硬性</span>' : ''}${check.detail ? `<span class="detail">${esc(check.detail)}</span>` : ''}</span></div>`).join('');
  return `<div class="section-title">结构检查</div><div class="check-grid">${items}</div>`;
}

function renderPreview(runId, model, test) {
  return `<div class="preview-card" data-run-id="${escAttr(runId)}" data-model="${escAttr(model)}">
    <div class="preview-head">
      <span class="title">HTML 预览</span>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="reload" data-run-id="${escAttr(runId)}" data-model="${escAttr(model)}">重载</button>
      <button class="btn btn-ghost btn-sm" type="button" data-action="download" data-run-id="${escAttr(runId)}" data-model="${escAttr(model)}">下载 HTML</button>
      <button class="btn btn-primary btn-sm" type="button" data-action="fullscreen" data-run-id="${escAttr(runId)}" data-model="${escAttr(model)}">全屏预览</button>
    </div>
    <div class="preview-frame-wrap">
      <iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="${escAttr(model)} 的水豚 HTML 预览" data-artifact-frame></iframe>
      <div class="preview-loading">正在加载 HTML…</div>
      <div class="preview-error" hidden></div>
    </div>
    <div class="preview-note">在 sandbox iframe 中运行；模型 HTML 不能访问本页数据。</div>
  </div>`;
}

function renderFiles(test) {
  const requests = test.requestFiles || (test.requestFile ? [test.requestFile] : []);
  const raw = test.rawFiles || [];
  if (!requests.length && !raw.length) return '';
  return `<details class="files"><summary>请求快照与原始响应（${requests.length + raw.length} 个文件）</summary><pre class="code-block">请求：\n${esc(requests.join('\n') || '—')}\n\n原始：\n${esc(raw.join('\n') || '—')}</pre></details>`;
}

function renderSkeleton() {
  return `<div class="loading-panel"><div class="skeleton-line w40"></div><div class="skeleton-line w70"></div><div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div></div></div>`;
}

function renderEmpty() {
  return `<div class="empty"><div class="icon">✦</div><h3>还没有测试记录</h3><p>先运行一次测试，本页会自动读取本地 <code>data/</code>，不会修改任何结果。</p><code>node app/run.mjs --station "站点" --url "https://api.example.com/v1" --key "sk-..."</code></div>`;
}

function iconBlock(symbol) {
  return `<div class="icon">${esc(symbol)}</div>`;
}

function renderErrorPanel(title, message, action) {
  const button = action === 'retry-load'
    ? '<button class="btn btn-ghost" type="button" data-action="retry-load">重试</button>'
    : '';
  return `<div class="error-panel">${iconBlock('!')}<h3>${esc(title)}</h3><p>${esc(message)}</p>${button}</div>`;
}

/* ---------------- 过滤 ---------------- */

function applyFilters() {
  if (state.loading || state.error || !state.groups.length) return;
  const query = els.search.value.trim().toLowerCase();
  const verdict = els.verdictFilter.value;
  let visible = 0;
  for (const groupEl of $$('.group', els.groups)) {
    const cards = $$('.model-card', groupEl);
    let groupVisible = 0;
    for (const card of cards) {
      const matchesQuery = !query || (card.dataset.model || '').includes(query);
      const matchesVerdict = verdict === 'all' || card.dataset.verdict === verdict;
      const show = matchesQuery && matchesVerdict;
      card.classList.toggle('is-hidden', !show);
      if (show) {
        visible += 1;
        groupVisible += 1;
      }
    }
    groupEl.classList.toggle('is-hidden', cards.length > 0 && groupVisible === 0);
  }
  const totalModels = state.groups.reduce((sum, group) => {
    const entry = group.data?.entry || group.runs.find((run) => run.runId === group.selectedRunId);
    return sum + Number(entry?.models || 0);
  }, 0);
  els.filterEmpty.hidden = visible !== 0 || totalModels === 0;
  els.meta.textContent = `共 ${state.groups.length} 个分组 · ${state.runs.length} 次运行 · 显示 ${visible} / ${totalModels} 个模型`;
}

/* ---------------- 预览与全屏 ---------------- */

async function loadArtifactHtml(runId, model) {
  const key = `${runId}|${model}`;
  const cached = state.artifacts.get(key);
  if (cached) {
    if (cached.error) throw cached.error;
    return cached.html;
  }
  try {
    const response = await fetch(`/api/artifact?run=${encodeURIComponent(runId)}&model=${encodeURIComponent(model)}`);
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 240);
      try {
        message = JSON.parse(text)?.error || message;
      } catch {
        // text/plain or html error
      }
      throw new Error(message || `HTTP ${response.status}`);
    }
    state.artifacts.set(key, { html: text });
    return text;
  } catch (error) {
    state.artifacts.set(key, { error });
    throw error;
  }
}

async function ensureArtifact(detailsEl) {
  const card = detailsEl?.querySelector('.preview-card');
  if (!card) return;
  if (card.dataset.loaded === '1' || card.dataset.loaded === 'error' || card.dataset.loading === '1') return;
  const frame = card.querySelector('[data-artifact-frame]');
  const loading = card.querySelector('.preview-loading');
  const error = card.querySelector('.preview-error');
  const runId = card.dataset.runId;
  const model = card.dataset.model;
  card.dataset.loading = '1';
  loading.hidden = false;
  error.hidden = true;
  frame.addEventListener('load', () => { loading.hidden = true; }, { once: true });
  try {
    const html = await loadArtifactHtml(runId, model);
    frame.srcdoc = withPreviewCsp(html);
    card.dataset.loaded = '1';
    loading.hidden = true;
  } catch (err) {
    error.textContent = `HTML 加载失败：${err.message}`;
    error.hidden = false;
    loading.hidden = true;
    card.dataset.loaded = 'error';
  } finally {
    delete card.dataset.loading;
  }
}

function ensureOpenPreviews() {
  for (const details of $$('details.test[open]')) {
    if (details.closest('.is-hidden')) continue;
    ensureArtifact(details);
  }
}

async function openFullscreen(button) {
  const runId = button.dataset.runId;
  const model = button.dataset.model;
  const html = await loadArtifactHtml(runId, model);
  state.modal = { runId, model, html };
  els.modalTitle.textContent = `${model} · 水豚 HTML`;
  els.modalFrame.srcdoc = withPreviewCsp(html);
  els.modal.hidden = false;
  document.body.classList.add('modal-open');
  els.modalClose.focus();
}

function closeModal() {
  els.modal.hidden = true;
  els.modalFrame.srcdoc = '';
  document.body.classList.remove('modal-open');
  state.modal = null;
}

async function downloadArtifact(runId, model) {
  const html = await loadArtifactHtml(runId, model);
  downloadHtml(html, model);
}

function downloadHtml(html, model) {
  const safe = String(model).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'capybara';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safe}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function reloadArtifact(button) {
  const card = button.closest('.preview-card');
  if (!card) return;
  const runId = card.dataset.runId;
  const model = card.dataset.model;
  state.artifacts.delete(`${runId}|${model}`);
  card.dataset.loaded = '';
  const frame = card.querySelector('[data-artifact-frame]');
  frame.removeAttribute('srcdoc');
  card.querySelector('.preview-loading').hidden = false;
  card.querySelector('.preview-error').hidden = true;
  ensureArtifact(button.closest('details.test'));
}

/* ---------------- 交互 ---------------- */

function bindEvents() {
  els.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next, true);
  });
  els.refreshBtn.addEventListener('click', () => load({ refresh: true }));
  els.search.addEventListener('input', applyFilters);
  els.verdictFilter.addEventListener('change', applyFilters);
  els.expandBtn.addEventListener('click', () => {
    for (const details of $$('details.model-card')) details.open = true;
  });
  els.collapseBtn.addEventListener('click', () => {
    for (const details of $$('details.model-card')) details.open = false;
  });
  els.modalClose.addEventListener('click', closeModal);
  els.modalDownload.addEventListener('click', () => {
    if (state.modal) downloadArtifact(state.modal.runId, state.modal.model).catch((error) => showToast(error.message, true));
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'close-modal') closeModal();
    if (action === 'fullscreen') openFullscreen(button).catch((error) => showToast(error.message, true));
    if (action === 'download') downloadArtifact(button.dataset.runId, button.dataset.model).catch((error) => showToast(error.message, true));
    if (action === 'reload') reloadArtifact(button);
    if (action === 'retry-group') retryGroup(button.dataset.groupId);
    if (action === 'retry-load') load({ refresh: true });
    if (action === 'clear-filters') {
      els.search.value = '';
      els.verdictFilter.value = 'all';
      applyFilters();
    }
  });

  document.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-run-select]');
    if (!select) return;
    const group = state.groups.find((item) => item.id === select.dataset.groupId);
    if (!group) return;
    group.selectedRunId = select.value;
    group.data = null;
    group.error = null;
    render();
    await loadGroup(group);
    render();
  });

  document.addEventListener('toggle', (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (details.dataset.groupKey) {
      if (details.open) state.closedGroups.delete(details.dataset.groupKey);
      else state.closedGroups.add(details.dataset.groupKey);
    }
    if (details.dataset.modelKey) {
      if (details.open) state.closedModels.delete(details.dataset.modelKey);
      else state.closedModels.add(details.dataset.modelKey);
    }
    if (details.dataset.testKey) {
      if (details.open) {
        state.openedTests.add(details.dataset.testKey);
        ensureArtifact(details);
      } else {
        state.openedTests.delete(details.dataset.testKey);
      }
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.modal.hidden) closeModal();
  });
}

async function retryGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  group.data = null;
  group.error = null;
  runCache.delete(group.selectedRunId);
  render();
  await loadGroup(group);
  render();
}

/* ---------------- 主题与提示 ---------------- */

function setTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  els.themeBtn.innerHTML = theme === 'light' ? MOON_ICON : SUN_ICON;
  els.themeBtn.setAttribute('aria-label', theme === 'light' ? '切换到深色主题' : '切换到浅色主题');
  if (persist) {
    try {
      localStorage.setItem('fine-apitest-theme', theme);
    } catch {
      // 忽略隐私模式下的 localStorage 失败
    }
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('fine-apitest-theme');
  } catch {
    saved = null;
  }
  setTheme(saved === 'light' ? 'light' : 'dark', false);
}

let toastTimer = null;
function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.className = `toast${isError ? ' error' : ''}`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4200);
}

/* ---------------- 格式化 ---------------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escAttr(value) {
  return esc(value).replace(/`/g, '&#96;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
  const value = Number(ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m${Math.round((value % 60_000) / 1000)}s`;
}

function fmtPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${(number * 100).toFixed(number >= 0.1 ? 1 : 2)}%`;
}

/* ---------------- 启动 ---------------- */

initTheme();
bindEvents();
load();
