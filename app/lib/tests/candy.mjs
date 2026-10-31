/**
 * 糖果自动判分（规则版本 candy-rule-v3）。
 *
 * 1. 前提校验：回答必须接受「形状可凭手感分辨、允许在袋内按形状挑选」；
 *    明确否认该前提的，即使结论写 21 也记「待复核」并标注「前提被否认」。
 * 2. 提取最终答案：优先取结论句中的整数；无结论句则要求全文唯一整数。
 * 3. 多个互相矛盾结论 / 无明确结论 / 推导与结论冲突 → 待复核。
 * 4. 与参考答案规范化比较。全程不引入 AI 裁判。
 */

export const CANDY_RULE_VERSION = 'candy-rule-v3';

/** 明确否认「形状可凭手感分辨 / 允许按形状挑选」的表述。 */
const PREMISE_DENY = [
  /无法(?:凭)?(?:手感|触摸|触感)(?:分辨|区分|辨别)/,
  /不能(?:凭)?(?:手感|触摸)(?:分辨|区分|辨别)/,
  /无法(?:按|根据|凭借)形状(?:挑选|选取|选择|分辨)/,
  /不能(?:按|根据|凭借)形状(?:挑选|选取|选择)/,
  /形状(?:无法|不能)(?:分辨|区分|辨别)/,
  /只能(?:完全)?随机(?:抽取|摸取|拿取)/,
  /相当于(?:完全)?随机(?:抽取|摸取)/,
  /不(?:能|可以)在袋内(?:挑选|选择)/,
  /无法区分形状/,
  /cannot (?:tell|distinguish) (?:the )?shapes?/i,
  /can'?t (?:tell|distinguish) (?:the )?shapes?/i,
  /random(?:ly)? (?:draw|pick|grab)/i,
];

/** 明确接受前提的表述（用于区分「未提及」与「已接受」）。 */
const PREMISE_ACCEPT = [
  /(?:可以|能够|能)(?:凭|根据|通过)手感(?:分辨|区分|辨别)/,
  /(?:可以|能够|能)(?:按|根据)形状(?:挑选|选取|选择)/,
  /形状(?:可以|能够|能)(?:分辨|区分|辨别)/,
  /允许(?:在袋内)?(?:按形状)?(?:挑选|选取|选择)/,
  /可分辨形状/,
  /can (?:tell|distinguish) (?:the )?shapes?/i,
];

const CONCLUSION_MARKERS = [
  /(?:最终)?答案(?:是|为|[:：])\s*([^\n。！？]*)/,
  /(?:结果|结论)(?:是|为|[:：])\s*([^\n。！？]*)/,
  /答[:：]\s*([^\n。！？]*)/,
  /(?:最少|至少)(?:需要|要|得)?(?:能够|可以)?(?:取出|摸出|拿出|取|拿|抽)?[^\n。！？]{0,12}?(\d[\d,，]*)\s*(?:个|颗|粒)?/,
  /answer\s*(?:is|=|:)\s*([^\n。！？]*)/i,
  /final\s*answer\s*(?:is|=|:)?\s*([^\n。！？]*)/i,
];

function normalizeNumber(raw) {
  const cleaned = raw.replace(/[,,，\s]/g, '');
  try {
    return BigInt(cleaned).toString();
  } catch {
    return cleaned;
  }
}

function intsIn(span) {
  return (span.match(/\d[\d,，]*/g) || []).map(normalizeNumber);
}

export function extractFinalAnswer(text) {
  const body = (text || '').trim();
  if (!body) return { value: null, reason: 'no_answer', candidates: [] };

  // 扫描全部结论片段（同一回答可能给出多个结论）；片段内出现多个不同数字即视为互相矛盾。
  const found = [];
  for (const re of CONCLUSION_MARKERS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of body.matchAll(global)) {
      const span = m[1] && /\d/.test(m[1]) ? m[1] : m[0];
      for (const n of intsIn(span)) found.push(n);
    }
  }
  const unique = Array.from(new Set(found));
  if (unique.length === 1) return { value: unique[0], reason: 'conclusion', candidates: unique };
  if (unique.length > 1) return { value: null, reason: 'conflicting_conclusions', candidates: unique };

  // 没有明确结论句：按计划口径一律待复核（「只出现数字」与「没明确结论」都在其列）。
  const all = Array.from(new Set(intsIn(body)));
  const isBareNumber = all.length <= 1 && /^[\s\d,，.个颗粒]*$/.test(body);
  return { value: null, reason: isBareNumber ? 'bare_number' : 'no_conclusion', candidates: all };
}

export function gradeCandy(answer, reference) {
  const ref = (reference || '').trim();
  const base = {
    verdict: 'review',
    extracted: null,
    reference: ref || null,
    premiseDenied: false,
    premiseAccepted: false,
    reason: '',
    extractionReason: '',
    ruleVersion: CANDY_RULE_VERSION,
  };
  const body = (answer || '').trim();
  if (!body) return { ...base, reason: 'no_answer', extractionReason: 'no_answer' };

  const denied = PREMISE_DENY.some((re) => re.test(body));
  const accepted = !denied && PREMISE_ACCEPT.some((re) => re.test(body));
  const { value, reason: extractionReason, candidates } = extractFinalAnswer(body);

  if (denied) {
    return {
      ...base,
      verdict: 'review',
      extracted: value,
      premiseDenied: true,
      premiseAccepted: false,
      reason: 'premise_denied',
      extractionReason,
    };
  }

  if (value === null) {
    return {
      ...base,
      verdict: 'review',
      extracted: null,
      premiseAccepted: accepted,
      reason: extractionReason,
      extractionReason,
    };
  }

  if (!ref) {
    return { ...base, verdict: 'review', extracted: value, premiseAccepted: accepted, reason: 'no_reference', extractionReason };
  }

  const refNorm = normalizeNumber(ref);
  if (value === refNorm) {
    // 结论正确但未表态前提的，仍判正确；只有明确否认才待复核。
    return { ...base, verdict: 'correct', extracted: value, premiseAccepted: accepted, reason: 'matched', extractionReason };
  }
  return { ...base, verdict: 'wrong', extracted: value, premiseAccepted: accepted, reason: 'mismatch', extractionReason, candidates };
}
