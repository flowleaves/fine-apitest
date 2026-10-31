/**
 * 总评规则。
 *
 * - 糖果：正确 / 错误 / 待复核；
 * - 指纹：只作为参考信息，不单独判定模型真假；证据不足或部分样本失败记待复核；
 * - 水豚 HTML：结构硬检查 + Agent 视觉复核；视觉复核通过可覆盖轻微结构警告；
 * - 任意硬失败 → 不通过；否则有待复核 → 待复核；三项全部通过 → 通过。
 */

const ARTIFACT_TEST_ID = 'capybara-html';

export function computeModelOverall(tests) {
  const reasons = [];
  let fail = false;
  let review = false;

  const candy = tests.candy;
  if (!candy || candy.status !== 'succeeded') {
    fail = true;
    reasons.push('糖果测试请求失败');
  } else if (candy.verdict === 'wrong') {
    fail = true;
    reasons.push('糖果答案错误');
  } else if (candy.verdict === 'review') {
    review = true;
    reasons.push('糖果答案待复核');
  }

  const fingerprint = tests.fingerprint;
  if (!fingerprint || fingerprint.status === 'failed') {
    fail = true;
    reasons.push('指纹测试请求失败');
  } else if (fingerprint.verdict === 'insufficient') {
    review = true;
    reasons.push('指纹证据不足');
  } else if (fingerprint.failedSamples > 0) {
    review = true;
    reasons.push(`指纹部分样本失败（${fingerprint.failedSamples}）`);
  }

  const artifact = tests[ARTIFACT_TEST_ID];
  if (!artifact || artifact.status !== 'succeeded') {
    fail = true;
    reasons.push('水豚 HTML 请求失败');
  } else if (artifact.verdict === 'fail') {
    fail = true;
    reasons.push('水豚 HTML 结构不合格');
  } else if (artifact.review?.verdict === 'fail') {
    fail = true;
    reasons.push('水豚 HTML 视觉复核不通过');
  } else if (artifact.review?.verdict === 'pass') {
    // 视觉复核通过：允许覆盖「缺 viewport / 未检测到事件绑定」这类轻微结构警告
  } else if (artifact.review?.verdict === 'review') {
    review = true;
    reasons.push('水豚 HTML 视觉复核待定');
  } else if (artifact.verdict === 'review') {
    review = true;
    reasons.push('水豚 HTML 结构待复核');
  } else {
    review = true;
    reasons.push('水豚 HTML 待视觉复核');
  }

  if (fail) return { verdict: 'fail', reasons };
  if (review) return { verdict: 'review', reasons };
  return { verdict: 'pass', reasons: ['三项测试均通过'] };
}

export function computeTotals(results, requestTotals = {}) {
  const totals = {
    models: results.length,
    pass: 0,
    review: 0,
    fail: 0,
    requests: Number(requestTotals.requests || 0),
    succeededRequests: Number(requestTotals.succeededRequests || 0),
    failedRequests: Number(requestTotals.failedRequests || 0),
  };
  for (const result of results) {
    const verdict = result.overall?.verdict || 'fail';
    if (verdict === 'pass') totals.pass += 1;
    else if (verdict === 'review') totals.review += 1;
    else totals.fail += 1;
  }
  return totals;
}

export const VERDICT_LABELS = {
  pass: '通过',
  review: '待复核',
  fail: '不通过',
};
