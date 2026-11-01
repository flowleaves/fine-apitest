/**
 * 结果页服务端 e2e：
 * 用本地 mock 跑一次真实 CLI，再启动只读结果服务，验证页面、运行、HTML、报告 API。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockServer } from './mock-upstream.mjs';
import { createResultServer } from '../app/serve.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SECRET = 'sk-web-secret-123456';

function runNode(script, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`超时：${script} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

test('结果页：静态页 + 运行/HTML/报告只读 API', async () => {
  const mock = await createMockServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fine-apitest-web-'));
  const dataDir = path.join(tmp, 'data');
  const logDir = path.join(tmp, 'logs');
  const recordFile = path.join(tmp, '测试记录.md');
  let resultServer;

  try {
    const run = await runNode(path.join(ROOT, 'app', 'run.mjs'), [
      '--station', 'WebStation',
      '--group', '默认',
      '--url', `http://127.0.0.1:${mock.port}/v1`,
      '--key', SECRET,
      '--model', 'mock-good',
      '--allow-private',
      '--retry', '0',
      '--json',
      '--data-dir', dataDir,
      '--log-dir', logDir,
      '--record-file', recordFile,
    ]);
    assert.equal(run.code, 0, run.stderr || run.stdout);
    const summary = JSON.parse(run.stdout);
    const runId = summary.runId;
    assert.ok(runId);

    resultServer = await createResultServer({ dataDir, host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${resultServer.port}`;

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /星芽/);

    const appJs = await fetch(`${base}/app.js`);
    assert.equal(appJs.status, 200);
    assert.match(await appJs.text(), /输出 token\/s/);

    const runs = await getJson(`${base}/api/runs`);
    assert.equal(runs.status, 200);
    assert.equal(runs.body.ok, true);
    assert.equal(runs.body.runs.length, 1);
    assert.equal(runs.body.runs[0].runId, runId);
    assert.equal(runs.body.runs[0].station, 'WebStation');

    const detail = await getJson(`${base}/api/run?run=${encodeURIComponent(runId)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.ok, true);
    assert.equal(detail.body.run.results.length, 1);
    const capybara = detail.body.run.results[0].tests['capybara-html'];
    assert.equal(capybara.verdict, 'ok');
    assert.ok(Number.isFinite(capybara.metrics?.firstContentMs));
    assert.ok(capybara.metrics && 'speedTps' in capybara.metrics);
    assert.ok(capybara.metrics.speedTps == null || capybara.metrics.speedTps > 0);

    const artifact = await fetch(`${base}/api/artifact?run=${encodeURIComponent(runId)}&model=mock-good`);
    assert.equal(artifact.status, 200);
    const artifactText = await artifact.text();
    assert.match(artifactText, /<html/i);
    assert.match(artifactText, /星芽/);

    const missingArtifact = await fetch(`${base}/api/artifact?run=${encodeURIComponent(runId)}&model=mock-bad`);
    assert.equal(missingArtifact.status, 404);

    const traversal = await fetch(`${base}/api/artifact?run=${encodeURIComponent(runId)}&model=${encodeURIComponent('../run')}`);
    assert.equal(traversal.status, 404);

    const report = await fetch(`${base}/api/report?run=${encodeURIComponent(runId)}`);
    assert.equal(report.status, 200);
    const reportText = await report.text();
    assert.match(reportText, /测试报告/);
    assert.match(reportText, /首字/);
    assert.match(reportText, /输出 token\/s/);

    const missingRun = await getJson(`${base}/api/run?run=nope`);
    assert.equal(missingRun.status, 404);

    const readOnly = await fetch(`${base}/api/run?run=${encodeURIComponent(runId)}`, { method: 'POST' });
    assert.equal(readOnly.status, 405);
  } finally {
    if (resultServer) await resultServer.close();
    await mock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
