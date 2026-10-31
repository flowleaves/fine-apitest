/**
 * 端到端：真实启动本地 mock 上游，跑完整 CLI，再走 review 流程。
 * 不需要任何真实中转站或 API Key。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockServer } from './mock-upstream.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SECRET = 'sk-e2e-secret-123456';

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
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test('e2e：发现模型 → 跑三项 → 归档 → 视觉复核 → 总评更新', async () => {
  const mock = await createMockServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fine-apitest-e2e-'));
  const dataDir = path.join(tmp, 'data');
  const logDir = path.join(tmp, 'logs');
  const recordFile = path.join(tmp, '测试记录.md');
  try {
    const run = await runNode(path.join(ROOT, 'app', 'run.mjs'), [
      '--station', 'MockStation',
      '--group', '默认',
      '--url', `http://127.0.0.1:${mock.port}/v1`,
      '--key', SECRET,
      '--allow-private',
      '--retry', '0',
      '--json',
      '--data-dir', dataDir,
      '--log-dir', logDir,
      '--record-file', recordFile,
    ]);
    assert.equal(run.code, 0, run.stderr || run.stdout);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.ok, true);
    assert.equal(summary.totals.models, 2);
    assert.equal(summary.totals.requests, 10);
    assert.equal(summary.totals.pass, 0);
    assert.equal(summary.totals.review, 1);
    assert.equal(summary.totals.fail, 1);

    const runDir = summary.runPath;
    const runFile = path.join(runDir, 'run.json');
    const runJson = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.equal(runJson.results.length, 2);

    const good = runJson.results.find((item) => item.model === 'mock-good');
    const bad = runJson.results.find((item) => item.model === 'mock-bad');
    assert.ok(good && bad);
    assert.equal(good.tests.candy.verdict, 'correct');
    assert.equal(bad.tests.candy.verdict, 'wrong');
    assert.equal(good.tests.fingerprint.verdict, 'predicted');
    assert.equal(good.tests['capybara-html'].verdict, 'ok');
    assert.equal(bad.tests['capybara-html'].verdict, 'fail');
    assert.equal(good.overall.verdict, 'review');
    assert.equal(bad.overall.verdict, 'fail');

    for (const id of ['capybara-html']) {
      const test = good.tests[id];
      assert.equal(test.status, 'succeeded');
      assert.ok(test.artifactFile, `${id} 应有产物`);
      const file = path.join(runDir, test.artifactFile);
      assert.ok(fs.existsSync(file), file);
      const content = fs.readFileSync(file, 'utf8');
      assert.match(content, /<html/i);
    }

    const summaryMd = fs.readFileSync(path.join(runDir, 'summary.md'), 'utf8');
    assert.match(summaryMd, /待 Agent 视觉复核/);
    assert.match(fs.readFileSync(recordFile, 'utf8'), new RegExp(runJson.runId));

    // 密钥不得出现在运行目录、报告或日志中
    for (const file of walk(runDir)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!text.includes(SECRET), `密钥泄露到 ${file}`);
    }
    assert.ok(!fs.readFileSync(recordFile, 'utf8').includes(SECRET));

    // 复核前：列出待复核 artifact
    const pending = await runNode(path.join(ROOT, 'app', 'review.mjs'), [
      '--run', runDir,
      '--list',
      '--data-dir', dataDir,
      '--record-file', recordFile,
      '--log-dir', logDir,
    ]);
    assert.equal(pending.code, 0, pending.stderr);
    assert.match(pending.stdout, /capybara-html/);

    for (const id of ['capybara-html']) {
      const review = await runNode(path.join(ROOT, 'app', 'review.mjs'), [
        '--run', runDir,
        '--model', 'mock-good',
        '--test', id,
        '--verdict', 'pass',
        '--note', 'e2e：水豚、墨镜、海滩、速度滑块、暂停与星芽艺术字正常',
        '--reviewer', 'e2e-agent',
        '--json',
        '--data-dir', dataDir,
        '--record-file', recordFile,
        '--log-dir', logDir,
      ]);
      assert.equal(review.code, 0, review.stderr || review.stdout);
      const payload = JSON.parse(review.stdout);
      assert.equal(payload.ok, true);
    }

    const updated = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    const updatedGood = updated.results.find((item) => item.model === 'mock-good');
    assert.equal(updatedGood.overall.verdict, 'pass');
    assert.equal(updated.totals.pass, 1);
    assert.equal(updated.totals.review, 0);
    assert.equal(updated.totals.fail, 1);
    assert.match(fs.readFileSync(recordFile, 'utf8'), new RegExp(updated.runId));

    // 第二次运行不传 --key，验证本地密钥复用
    const reuse = await runNode(path.join(ROOT, 'app', 'run.mjs'), [
      '--station', 'MockStation',
      '--group', '默认',
      '--url', `http://127.0.0.1:${mock.port}/v1`,
      '--model', 'mock-good',
      '--allow-private',
      '--retry', '0',
      '--json',
      '--data-dir', dataDir,
      '--log-dir', logDir,
      '--record-file', recordFile,
    ]);
    assert.equal(reuse.code, 0, reuse.stderr || reuse.stdout);
    const reuseSummary = JSON.parse(reuse.stdout);
    assert.equal(reuseSummary.totals.models, 1);
    assert.equal(reuseSummary.totals.requests, 5);
  } finally {
    await mock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
