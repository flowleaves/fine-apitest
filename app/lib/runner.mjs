/**
 * 运行编排：发现模型 → 生成任务 → 全并发请求 → 判分 → 归档。
 *
 * 目录约定：
 *   data/<站点>/<分组>/<runId>/
 *     run.json / summary.md / requests/ / responses/ / artifacts/ / logs/
 */
import path from 'node:path';
import {
  ensureDir,
  formatDuration,
  keyFingerprint,
  makeRunId,
  nowIso,
  relPath,
  safeSegment,
  truncate,
  uniqueNames,
  writeJson,
  writeText,
} from './util.mjs';
import { Logger, redact } from './log.mjs';
import { buildBody, chatCompletionsUrl, DEFAULT_TIMEOUTS, runChatWithRetry } from './chat.mjs';
import { discoverModels } from './models.mjs';
import { assertSafeTarget, normalizeBaseUrl } from './netguard.mjs';
import { CANDY_REFERENCE, TESTS } from './tests/definitions.mjs';
import { gradeCandy } from './tests/candy.mjs';
import { analyzeFingerprint, firstChallenges, loadBank, parseNumbers } from './tests/fingerprint.mjs';
import { evaluateArtifact } from './tests/artifact.mjs';
import { computeModelOverall, computeTotals } from './overall.mjs';
import { renderSummary, updateIndex } from './report.mjs';

function aggregateUsage(items) {
  const usages = items.map((item) => item.result.usage).filter(Boolean);
  if (!usages.length) return null;
  const sum = (key) => (usages.every((usage) => usage[key] != null)
    ? usages.reduce((total, usage) => total + Number(usage[key] || 0), 0)
    : null);
  return {
    input: sum('input'),
    output: sum('output'),
    total: sum('total'),
    reasoning: sum('reasoning'),
    raw: null,
  };
}

function aggregateMetrics(items) {
  const metrics = items.map((item) => item.result.timings).filter(Boolean);
  if (!metrics.length) return null;
  const sum = (key) => metrics.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  const avg = (key) => {
    const values = metrics.map((item) => Number(item[key])).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  };
  const okItems = items.filter((item) => item.result.ok && item.result.content?.trim());
  const generationMs = okItems.reduce((total, item) => total + (Number(item.result.timings?.generationMs) || 0), 0);
  const output = okItems.reduce((total, item) => total + (Number(item.result.usage?.output) || 0), 0);
  return {
    totalMs: sum('totalMs'),
    headersMs: avg('headersMs'),
    firstContentMs: avg('firstContentMs'),
    generationMs,
    speedTps: output > 0 && generationMs > 0 ? output / (generationMs / 1000) : null,
    speedCps: null,
    nonStream: metrics.every((item) => item.nonStream),
  };
}

function uniqueWarnings(items) {
  return [...new Set(items.flatMap((item) => item.result.warnings || []))];
}

function attemptDetails(result) {
  return (result.attempts || []).map((attempt) => ({
    attempt: attempt.attempt,
    ok: attempt.ok,
    httpStatus: attempt.httpStatus,
    error: attempt.error,
    timings: attempt.timings,
    finishReason: attempt.finishReason,
    warnings: attempt.warnings,
  }));
}

function buildCommon(test, item) {
  const result = item.result;
  return {
    id: test.id,
    name: test.name,
    kind: test.kind,
    status: result.ok ? 'succeeded' : 'failed',
    error: result.error || null,
    httpStatus: result.httpStatus ?? null,
    metrics: result.timings,
    usage: result.usage,
    finishReason: result.finishReason,
    warnings: result.warnings || [],
    attempts: result.attempts?.length || 1,
    attemptDetails: attemptDetails(result),
    requestFile: item.requestFile || null,
    rawFiles: item.rawFiles || [],
    maxTokens: item.task?.maxTokens ?? test.maxTokens ?? null,
  };
}

function buildCandy(test, item) {
  const base = buildCommon(test, item);
  if (!item.result.ok) return { ...base, verdict: 'fail', grade: null, answer: null };
  const grade = gradeCandy(item.result.content, CANDY_REFERENCE);
  return { ...base, verdict: grade.verdict, grade, answer: item.result.content };
}

function buildFingerprint(test, items, bank) {
  const samples = items.map((item) => ({
    slot: item.task.slot,
    challengeId: item.task.challenge?.challenge_id || null,
    expectedCount: item.task.challenge?.expected_count || null,
    status: item.result.ok ? 'succeeded' : 'failed',
    error: item.result.error || null,
    httpStatus: item.result.httpStatus ?? null,
    metrics: item.result.timings,
    answerChars: item.result.content?.length || 0,
    parsedNumbers: item.result.ok ? parseNumbers(item.result.content).length : 0,
    answerPreview: item.result.ok ? truncate(item.result.content, 500) : '',
    requestFile: item.requestFile || null,
    rawFiles: item.rawFiles || [],
  }));
  const okItems = items.filter((item) => item.result.ok && item.result.content.trim());
  const base = {
    id: test.id,
    name: test.name,
    kind: test.kind,
    status: okItems.length ? 'succeeded' : 'failed',
    error: okItems.length ? null : (items[0]?.result.error || { category: 'no_samples', message: '没有成功样本' }),
    httpStatus: items[0]?.result.httpStatus ?? null,
    metrics: aggregateMetrics(items),
    usage: aggregateUsage(items),
    finishReason: items[0]?.result.finishReason ?? null,
    warnings: uniqueWarnings(items),
    attempts: items.reduce((total, item) => total + (item.result.attempts?.length || 1), 0),
    attemptDetails: items.flatMap((item) => attemptDetails(item.result)),
    requestFiles: items.map((item) => item.requestFile).filter(Boolean),
    rawFiles: items.flatMap((item) => item.rawFiles || []),
    samples,
    okSamples: okItems.length,
    failedSamples: samples.filter((sample) => sample.status === 'failed').length,
    diagnostics: [],
  };
  if (!okItems.length) return { ...base, verdict: 'failed' };

  const outputs = okItems.map((item) => ({
    expected_count: item.task.challenge.expected_count,
    text: item.result.content,
  }));
  const analysis = analyzeFingerprint(outputs, bank);
  if (analysis.ok) {
    return { ...base, verdict: 'predicted', result: analysis.result, diagnostics: analysis.result.diagnostics };
  }
  return { ...base, verdict: 'insufficient', diagnostics: analysis.diagnostics };
}

function buildArtifact(test, item, runDir, modelDir) {
  const base = buildCommon(test, item);
  if (!item.result.ok) {
    return {
      ...base,
      verdict: 'fail',
      reason: item.result.error?.message || '请求失败',
      artifactFile: null,
      bytes: 0,
      lines: 0,
      checks: [],
      review: null,
    };
  }
  const evaluation = evaluateArtifact(item.result.content, test.artifact, {
    finishReason: item.result.finishReason,
    maxTokens: item.task?.maxTokens ?? test.maxTokens ?? null,
  });
  let artifactFile = null;
  if (evaluation.artifact) {
    const file = path.join(
      runDir,
      'artifacts',
      modelDir,
      test.fileName || 'artifact.html',
    );
    writeText(file, evaluation.artifact);
    artifactFile = relPath(runDir, file);
  }
  return {
    ...base,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    artifactFile,
    bytes: evaluation.bytes,
    lines: evaluation.lines,
    checks: evaluation.checks,
    truncated: evaluation.truncated,
    external: evaluation.external,
    review: null,
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const limit = concurrency && concurrency > 0 ? Math.min(concurrency, items.length) : items.length;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function executeRun(options) {
  const startedAt = nowIso();
  const runId = makeRunId();
  const station = String(options.station || '').trim();
  const group = String(options.group || '默认').trim() || '默认';
  if (!station) throw new Error('缺少站点名称 --station');
  if (!options.apiKey) throw new Error('缺少 API Key');

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  await assertSafeTarget(baseUrl, { allowPrivate: Boolean(options.allowPrivate) });

  const dataDir = options.dataDir;
  const logDir = options.logDir;
  const recordFile = options.recordFile;
  const logger = new Logger({ files: [path.join(logDir, 'fine-apitest.log')], quiet: Boolean(options.json) });
  logger.info(`开始运行：${station} / ${group}`, {
    baseUrl,
    key: keyFingerprint(options.apiKey),
    mode: options.models?.length ? '指定模型' : '自动发现',
  });

  let models = options.models?.length ? [...new Set(options.models)] : null;
  if (!models) {
    logger.info('自动发现模型：GET /models');
    const discovery = await discoverModels({
      baseUrl,
      apiKey: options.apiKey,
      allowPrivate: Boolean(options.allowPrivate),
    });
    models = discovery.models;
    logger.info(`发现 ${models.length} 个模型：${models.join('、')}`);
  }
  if (!models.length) throw new Error('没有可测试的模型');

  const bank = loadBank(options.bankPath);
  const runDir = path.join(dataDir, safeSegment(station), safeSegment(group), runId);
  ensureDir(runDir);
  logger.addFile(path.join(runDir, 'logs', 'run.log'));

  const modelDirs = uniqueNames(models);
  const challenges = firstChallenges(3);
  const tasks = [];
  for (const model of models) {
    for (const test of TESTS) {
      if (test.kind === 'fingerprint') {
        challenges.forEach((challenge, slot) => {
          tasks.push({
            model,
            test,
            slot,
            prompt: challenge.prompt,
            systemPrompt: challenge.system || null,
            challenge,
            maxTokens: options.maxTokens ?? test.maxTokens ?? null,
          });
        });
      } else {
        tasks.push({
          model,
          test,
          slot: 0,
          prompt: test.prompt,
          systemPrompt: null,
          challenge: null,
          maxTokens: options.maxTokens ?? test.maxTokens ?? null,
        });
      }
    }
  }

  const requestPath = (task) => {
    const parts = ['requests', modelDirs.get(task.model), task.test.id];
    if (task.test.kind === 'fingerprint') parts.push(`slot-${task.slot + 1}`);
    return path.join(runDir, ...parts, 'request.json');
  };
  const rawPath = (task, attempt) => {
    const parts = ['responses', modelDirs.get(task.model), task.test.id];
    if (task.test.kind === 'fingerprint') parts.push(`slot-${task.slot + 1}`);
    return path.join(runDir, ...parts, `attempt-${attempt}.txt`);
  };

  logger.info(`派发 ${tasks.length} 个请求（${models.length} 个模型 × 三项测试；全并发=${!options.concurrency || options.concurrency <= 0}）`);

  let completed = 0;
  const results = await runPool(tasks, options.concurrency, async (task) => {
    try {
      const requestFile = requestPath(task);
      const requestBody = buildBody({
        model: task.model,
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        maxTokens: task.maxTokens,
        stream: true,
      });
      writeJson(requestFile, {
        model: task.model,
        test: task.test.id,
        testName: task.test.name,
        slot: task.slot,
        challengeId: task.challenge?.challenge_id || null,
        expectedCount: task.challenge?.expected_count || null,
        url: chatCompletionsUrl(baseUrl),
        method: 'POST',
        headers: {
          authorization: 'Bearer <redacted>',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: requestBody,
        maxTokens: task.maxTokens,
        timeouts: options.timeouts,
        startedAt: nowIso(),
      });

      const rawFiles = [];
      const result = await runChatWithRetry({
        baseUrl,
        apiKey: options.apiKey,
        model: task.model,
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        maxTokens: task.maxTokens,
        timeouts: options.timeouts,
        retry: options.retry,
        onAttempt: (attemptResult, attempt) => {
          const file = rawPath(task, attempt.attempt);
          writeText(file, redact(attemptResult.raw || ''));
          rawFiles.push(relPath(runDir, file));
        },
      });

      completed += 1;
      const state = result.ok ? 'ok' : (result.error?.category || 'failed');
      logger.info(
        `[${completed}/${tasks.length}] ${task.model} · ${task.test.name}${task.test.kind === 'fingerprint' ? ` #${task.slot + 1}` : ''} → ${state}`,
        {
          httpStatus: result.httpStatus,
          ms: result.timings?.totalMs,
          attempts: result.attempts?.length,
        },
      );
      return {
        task,
        result,
        requestFile: relPath(runDir, requestFile),
        rawFiles,
      };
    } catch (err) {
      completed += 1;
      logger.error(`[${completed}/${tasks.length}] ${task.model} · ${task.test.name} 内部错误：${err.message}`);
      return {
        task,
        result: {
          ok: false,
          httpStatus: null,
          content: '',
          reasoning: '',
          usage: null,
          finishReason: null,
          raw: '',
          warnings: [],
          error: { category: 'internal_error', message: err.message, retryable: false },
          timings: { totalMs: 0 },
          attempts: [],
        },
        requestFile: null,
        rawFiles: [],
      };
    }
  });

  const byModel = new Map();
  for (const model of models) {
    byModel.set(model, new Map(TESTS.map((test) => [test.id, []])));
  }
  for (const item of results) {
    byModel.get(item.task.model).get(item.task.test.id).push(item);
  }
  for (const tests of byModel.values()) {
    for (const list of tests.values()) list.sort((a, b) => a.task.slot - b.task.slot);
  }

  const modelResults = [];
  for (const model of models) {
    const tests = {};
    for (const test of TESTS) {
      const items = byModel.get(model).get(test.id);
      if (test.kind === 'candy') tests[test.id] = buildCandy(test, items[0]);
      else if (test.kind === 'fingerprint') tests[test.id] = buildFingerprint(test, items, bank);
      else tests[test.id] = buildArtifact(test, items[0], runDir, modelDirs.get(model));
    }
    const overall = computeModelOverall(tests);
    modelResults.push({
      model,
      modelDir: modelDirs.get(model),
      tests,
      overall,
    });
  }

  const requestTotals = {
    requests: results.length,
    succeededRequests: results.filter((item) => item.result.ok).length,
    failedRequests: results.filter((item) => !item.result.ok).length,
  };
  const totals = computeTotals(modelResults, requestTotals);
  const finishedAt = nowIso();
  const run = {
    version: 1,
    runId,
    startedAt,
    finishedAt,
    station,
    group,
    baseUrl,
    keyFingerprint: keyFingerprint(options.apiKey),
    models,
    modelDirs: Object.fromEntries(modelDirs),
    concurrency: options.concurrency || 0,
    retry: options.retry,
    timeouts: options.timeouts,
    maxTokens: options.maxTokens ?? null,
    totals,
    results: modelResults,
    notes: [
      '指纹结论只作参考，不构成模型真假判定。',
      'artifact 结构检查不能代替视觉复核。',
    ],
  };

  const runFile = path.join(runDir, 'run.json');
  writeJson(runFile, run);
  const summaryPath = path.join(runDir, 'summary.md');
  writeText(summaryPath, renderSummary(run));
  updateIndex({ dataDir, recordFile, run, runDir });

  logger.info(
    `完成：模型 ${totals.models} · 通过 ${totals.pass} · 待复核 ${totals.review} · 不通过 ${totals.fail} · 请求 ${totals.succeededRequests}/${totals.requests} 成功`,
    { runDir, duration: formatDuration(new Date(finishedAt) - new Date(startedAt)) },
  );
  return { run, runDir, summaryPath, runFile };
}
