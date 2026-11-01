/**
 * 零依赖单元测试：node --test tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SseDecoder } from '../app/lib/sse.mjs';
import { buildBody, runChatOnce } from '../app/lib/chat.mjs';
import { redact } from '../app/lib/log.mjs';
import { gradeCandy } from '../app/lib/tests/candy.mjs';
import { TESTS } from '../app/lib/tests/definitions.mjs';
import { evaluateArtifact } from '../app/lib/tests/artifact.mjs';
import { analyzeFingerprint, firstChallenges, loadBank, parseNumbers } from '../app/lib/tests/fingerprint.mjs';
import { classifyAddress, normalizeBaseUrl } from '../app/lib/netguard.mjs';
import { computeModelOverall } from '../app/lib/overall.mjs';
import { renderIndex, renderSummary } from '../app/lib/report.mjs';
import { findKey, forgetKey, listKeys, saveKey } from '../app/lib/secrets.mjs';
import { safeSegment, uniqueNames } from '../app/lib/util.mjs';

const BANK_PATH = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'app', 'data', 'unified_bank.json');

describe('SSE 解码器', () => {
  it('支持拆包、多行 data、CRLF 与注释', () => {
    const dec = new SseDecoder();
    const a = dec.push(Buffer.from('data: {"a":1}\r\n\r\n: ping\r\ndata: hello\r\n'));
    const events = a.filter((msg) => !msg.comment);
    assert.equal(events.length, 1);
    assert.equal(events[0].data, '{"a":1}');
    const b = dec.push(Buffer.from('data: world\r\n\r\n'));
    assert.equal(b.length, 1);
    assert.equal(b[0].data, 'hello\nworld');
  });

  it('end() 冲刷最后一个事件', () => {
    const dec = new SseDecoder();
    dec.push(Buffer.from('data: [DONE]'));
    const out = dec.end();
    assert.equal(out.length, 1);
    assert.equal(out[0].data, '[DONE]');
  });
});

describe('Chat 传输', () => {
  it('content-type 不是 text/event-stream 时也能解析 SSE', async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n'
        + 'data: [DONE]\n\n',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
      const result = await runChatOnce({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test',
        model: 'mock',
        prompt: 'hello',
        timeouts: { connect: 5000, first: 5000, gap: 5000, total: 10000 },
      });
      assert.equal(result.ok, true);
      assert.equal(result.content, 'hello');
      assert.equal(result.timings.nonStream, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('Chat 请求体', () => {
  it('默认不发送 max_tokens，输出上限交给上游', () => {
    const body = buildBody({ model: 'mock', prompt: 'hi', stream: false });
    assert.equal('max_tokens' in body, false);
  });

  it('显式 maxTokens 时才发送 max_tokens', () => {
    const body = buildBody({ model: 'mock', prompt: 'hi', stream: false, maxTokens: 4096 });
    assert.equal(body.max_tokens, 4096);
  });

  it('三项测试定义不设置默认 maxTokens', () => {
    for (const test of TESTS) assert.equal(test.maxTokens, undefined);
  });
});

describe('日志脱敏', () => {
  it('隐藏 sk- 密钥与 Bearer token', () => {
    const text = redact('key=sk-abcdef1234567890 Authorization: Bearer abcdefghijklmnop');
    assert.doesNotMatch(text, /sk-abcdef1234567890/);
    assert.doesNotMatch(text, /abcdefghijklmnop/);
  });
});

describe('糖果判分', () => {
  it('答案 21 判正确', () => {
    const result = gradeCandy('答案：21', '21');
    assert.equal(result.verdict, 'correct');
    assert.equal(result.extracted, '21');
  });

  it('答案 20 判错误', () => {
    const result = gradeCandy('答案：20', '21');
    assert.equal(result.verdict, 'wrong');
  });

  it('明确否认前提时即使答案正确也待复核', () => {
    const result = gradeCandy('无法凭手感分辨形状。答案：21', '21');
    assert.equal(result.verdict, 'review');
    assert.equal(result.premiseDenied, true);
  });

  it('多个矛盾结论待复核', () => {
    const result = gradeCandy('答案：21。另一个答案：20。', '21');
    assert.equal(result.verdict, 'review');
  });
});

describe('artifact 结构检查', () => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capybara Beach</title>
<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .wheel { animation: spin 1s linear infinite; }
  @media (max-width: 640px) { .ui { width: 90%; } }
</style>
</head>
<body>
<div class="brand">星芽</div>
<div class="ui">
  <input id="speed" type="range" min="0.3" max="3" step="0.1" value="1">
  <button id="pause" type="button">暂停</button>
</div>
<svg viewBox="0 0 300 200"><circle class="wheel" cx="60" cy="140" r="30"/><path d="M60 140 L130 80 L200 140" fill="none" stroke="#333"/></svg>
<script>
  document.getElementById('speed').addEventListener('input', () => {});
  document.getElementById('pause').addEventListener('click', () => {});
  requestAnimationFrame(() => {});
</script>
<!-- ${'padding '.repeat(260)} -->
</body>
</html>`;

  it('提取 fenced HTML 并通过结构检查', () => {
    const result = evaluateArtifact(`这是结果：\n\`\`\`html\n${html}\n\`\`\``, 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'ok');
    assert.match(result.artifact, /<html/);
  });

  it('缺少速度滑块时不合格', () => {
    const result = evaluateArtifact(html.replace(/<input id="speed"[^>]*>/, ''), 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'fail');
  });

  it('速度滑块范围不足时不合格', () => {
    const result = evaluateArtifact(html.replace('min="0.3" max="3"', 'min="0" max="2"'), 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'fail');
  });

  it('缺少暂停按钮时不合格', () => {
    const result = evaluateArtifact(html.replace(/<button id="pause"[^>]*>暂停<\/button>/, ''), 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'fail');
  });

  it('缺少「星芽」时不合格', () => {
    const result = evaluateArtifact(html.replace('星芽', 'Capybara'), 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'fail');
  });

  it('外链脚本 HTML 不合格', () => {
    const result = evaluateArtifact(html.replace('</body>', '<script src="https://cdn.example.com/a.js"></script></body>'), 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'fail');
  });

  it('截断的 HTML 不合格', () => {
    const result = evaluateArtifact(html, 'html', { finishReason: 'length' });
    assert.equal(result.verdict, 'fail');
  });

  it('没有产物时不合格', () => {
    const result = evaluateArtifact('抱歉，我无法完成。', 'html', { finishReason: 'stop' });
    assert.equal(result.verdict, 'fail');
  });
});

describe('指纹', () => {
  it('前三个挑战与现有平台一致', () => {
    const challenges = firstChallenges(3);
    assert.deepEqual(challenges.map((item) => item.expected_count), [218, 233, 247]);
    assert.deepEqual(challenges.map((item) => item.challenge_id), ['query-01', 'query-02', 'query-03']);
  });

  it('parseNumbers 取最长连续数字段', () => {
    const numbers = parseNumbers('prefix 1 2 3 end ' + JSON.stringify(Array.from({ length: 100 }, (_, i) => i + 1)));
    assert.equal(numbers.length, 100);
  });

  it('三组有效输出可归因', () => {
    const bank = loadBank(BANK_PATH);
    const challenges = firstChallenges(3);
    const outputs = challenges.map((challenge, index) => ({
      expected_count: challenge.expected_count,
      text: JSON.stringify(Array.from({ length: challenge.expected_count }, (_, i) => ((i * 37 + index * 11) % 355) + 1)),
    }));
    const result = analyzeFingerprint(outputs, bank);
    assert.equal(result.ok, true);
    assert.ok(result.result.results.length > 0);
    assert.ok(result.result.probability > 0);
  });

  it('有效数字不足时返回 insufficient', () => {
    const bank = loadBank(BANK_PATH);
    const result = analyzeFingerprint([{ expected_count: 218, text: '1 2 3' }], bank);
    assert.equal(result.ok, false);
    assert.equal(result.evidence, 'insufficient');
  });
});

describe('网络校验', () => {
  it('补全 /v1', () => {
    assert.equal(normalizeBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
    assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
    assert.equal(normalizeBaseUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1');
    assert.equal(normalizeBaseUrl('api.example.com/v1'), 'https://api.example.com/v1');
  });

  it('拒绝 URL 内嵌账号密码', () => {
    assert.throws(() => normalizeBaseUrl('https://user:pass@example.com/v1'), /不能内嵌/);
  });

  it('识别私网与公网地址', () => {
    assert.equal(classifyAddress('127.0.0.1').private, true);
    assert.equal(classifyAddress('10.1.2.3').private, true);
    assert.equal(classifyAddress('169.254.169.254').private, true);
    assert.equal(classifyAddress('1.1.1.1').private, false);
    assert.equal(classifyAddress('::1').private, true);
    assert.equal(classifyAddress('2606:4700:4700::1111').private, false);
  });
});

describe('总评', () => {
  const passingTests = () => ({
    candy: { status: 'succeeded', verdict: 'correct', name: '糖果测试' },
    fingerprint: { status: 'succeeded', verdict: 'predicted', name: '模型指纹检测' },
    'capybara-html': { status: 'succeeded', verdict: 'ok', name: '水豚 · 海滩骑行 HTML', review: { verdict: 'pass' } },
  });

  it('三项都通过才通过', () => {
    assert.equal(computeModelOverall(passingTests()).verdict, 'pass');
  });

  it('糖果错误直接不通过', () => {
    const tests = passingTests();
    tests.candy.verdict = 'wrong';
    assert.equal(computeModelOverall(tests).verdict, 'fail');
  });

  it('artifact 未视觉复核时待复核', () => {
    const tests = passingTests();
    delete tests['capybara-html'].review;
    assert.equal(computeModelOverall(tests).verdict, 'review');
  });

  it('指纹证据不足时待复核', () => {
    const tests = passingTests();
    tests.fingerprint.verdict = 'insufficient';
    assert.equal(computeModelOverall(tests).verdict, 'review');
  });

  it('指纹部分样本失败时待复核', () => {
    const tests = passingTests();
    tests.fingerprint.failedSamples = 1;
    assert.equal(computeModelOverall(tests).verdict, 'review');
  });
});

describe('报告与索引', () => {
  const run = {
    runId: '20260101T000000Z_abcdef',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:01:00.000Z',
    station: '测试站',
    group: '默认',
    baseUrl: 'https://api.example.com/v1',
    keyFingerprint: 'sha256:deadbeef',
    totals: { models: 1, pass: 1, review: 0, fail: 0, requests: 5, succeededRequests: 5, failedRequests: 0 },
    results: [{
      model: 'mock-model',
      overall: { verdict: 'pass', reasons: ['三项测试均通过'] },
      tests: {
        candy: { name: '糖果测试', kind: 'candy', status: 'succeeded', verdict: 'correct', grade: { extracted: '21', reference: '21', reason: 'matched' }, answer: '答案：21', metrics: { totalMs: 100, firstContentMs: 80, speedTps: 42.5 } },
        fingerprint: { name: '模型指纹检测', kind: 'fingerprint', status: 'succeeded', verdict: 'predicted', result: { prediction: 'x', prediction_name: 'x', probability: 0.9, family_prediction: 'f', family_prediction_name: 'F', family_probability: 0.9, used_outputs: 3, results: [] }, samples: [], metrics: { totalMs: 200, firstContentMs: 90, speedTps: 30.2 } },
        'capybara-html': { name: '水豚 · 海滩骑行 HTML', kind: 'artifact', status: 'succeeded', verdict: 'ok', artifactFile: 'artifacts/x/capybara.html', bytes: 4000, lines: 80, checks: [], review: { verdict: 'pass', reviewer: 'agent', reviewedAt: '2026-01-01T00:00:30.000Z' }, metrics: { totalMs: 400, firstContentMs: 120, speedTps: 18.4 } },
      },
    }],
  };

  it('summary 包含总览与模型段落，且不含密钥', () => {
    const text = renderSummary(run);
    assert.match(text, /# 测试报告/);
    assert.match(text, /## 总览/);
    assert.match(text, /水豚 HTML/);
    assert.match(text, /mock-model/);
    assert.match(text, /首字/);
    assert.match(text, /输出 token\/s/);
    assert.match(text, /42\.5 t\/s/);
    assert.doesNotMatch(text, /sk-secret/);
  });

  it('index 包含运行 ID 与报告链接', () => {
    const text = renderIndex([{ ...run, summaryPath: 'data/x/summary.md' }]);
    assert.match(text, /20260101T000000Z_abcdef/);
    assert.match(text, /data\/x\/summary\.md/);
  });
});

describe('密钥存储', () => {
  it('保存、查找、列出、删除', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fine-apitest-keys-'));
    try {
      saveKey(dir, { station: '站A', group: '默认', baseUrl: 'https://a.example/v1', key: 'sk-test-12345678' });
      const found = findKey(dir, '站A', '默认');
      assert.equal(found.key, 'sk-test-12345678');
      const list = listKeys(dir);
      assert.equal(list.length, 1);
      assert.doesNotMatch(list[0].keyMasked, /12345678/);
      assert.equal(forgetKey(dir, '站A', '默认'), true);
      assert.equal(findKey(dir, '站A', '默认'), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('路径安全', () => {
  it('安全化并处理碰撞', () => {
    assert.equal(safeSegment('a/b:c'), 'a_b_c');
    const map = uniqueNames(['a/b', 'a:b']);
    assert.notEqual(map.get('a/b'), map.get('a:b'));
  });
});
