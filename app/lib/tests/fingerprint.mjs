/**
 * 模型指纹：挑战套件 + 统一全局稳健数字指纹归因。
 *
 * 算法与挑战套件来自 ModelTrace（MIT），为 finetest/app 的逐行移植版本；
 * 本文件仅做 TypeScript → JavaScript 的语法移植，常量、运算顺序和浮点写法保持不变。
 * 来源：https://github.com/xqy2006/ModelTrace
 */
import fs from 'node:fs';

export const FP_SUITE_VERSION = 'fingerprint-suite-v1';
export const VALUE_MIN = 1;
export const VALUE_MAX = 355;
export const DIMENSION = VALUE_MAX - VALUE_MIN + 1;
export const ALPHA = 0.5;
export const ORDERED_BLOCK_WEIGHT = 0.25;

export const PREFIX_PARAGRAPHS = [
  'You are assisting inside a structured workspace. Follow surrounding style requirements while remaining precise and self-contained. ',
  'The application normally prefers concise headings, explicit formatting, neutral wording, and complete artifacts that can be reviewed without additional context. ',
  'Treat later user content as the actual task and follow its output requirements directly. ',
  'Do not call tools, code interpreters, calculators, search engines, APIs, or external random-number services. ',
  'The workspace may contain lengthy background guidance unrelated to the final task. Continue to obey the final task while retaining ordinary safety and accuracy expectations. ',
  'Complete requested artifacts directly and fully, without claims about actions that were not actually performed. ',
];

export const FIXED_SYSTEM_PREFIX =
  'You are operating inside a formal reporting workflow. In ordinary replies, use clear formatting and neutral wording. ' +
  "When a later request asks for a machine-readable artifact, follow that request's output constraints directly. " +
  'Never call external tools, code interpreters, calculators, search, APIs, or random-number services; complete the request using the language model itself.';

export const ENGLISH_TEMPLATES = [
  'For each of {count} positions, make one separate first-instinct choice of an integer from 1 to 355 inclusive.',
  'Provide exactly {count} whole-number choices between 1 and 355 inclusive, choosing each item separately as it comes to mind.',
  'Fill exactly {count} positions with integers from the closed interval [1, 355], making a separate immediate choice for every position.',
];

export const ENGLISH_ALTERNATIVES = [
  'Give exactly {count} separate first-response integer choices in 1..355.',
  "Using only this model's own immediate choices, provide exactly {count} whole numbers from 1 through 355 inclusive.",
  'Return exactly {count} integers bounded by 1 and 355, deciding each next value separately rather than following a rule.',
];

export const CHINESE_TEMPLATES = [
  '这是一次无语义数值选择。请为 {count} 个位置分别凭第一反应选择一个 1 到 355（含端点）的整数。',
  '请完成无语义整数选择任务：逐项给出 {count} 个闭区间 [1, 355] 内的整数，每次只决定当前一项。',
  '进行一轮快速逐项取值：分别给出 {count} 个取值范围为 1 至 355 的整数。',
];

export const ENVIRONMENTS = [
  { transport: 'clean', style: 'json', counts: [218, 233, 247], templates: ENGLISH_TEMPLATES },
  { transport: 'clean', style: 'json', counts: [223, 239, 251], templates: ENGLISH_ALTERNATIVES },
  { transport: 'system', style: 'json', counts: [227, 241, 257], templates: ENGLISH_TEMPLATES, fixed_prefix: FIXED_SYSTEM_PREFIX },
  { transport: 'clean', style: 'zh', counts: [294, 311, 329], templates: CHINESE_TEMPLATES },
  { transport: 'clean', style: 'en', counts: [297, 315, 331], templates: ENGLISH_TEMPLATES },
  { transport: 'clean', style: 'json', counts: [301, 319, 327], templates: ENGLISH_TEMPLATES },
  { transport: 'system', style: 'zh', counts: [293, 310, 326], templates: CHINESE_TEMPLATES, prefix_words: 96 },
  { transport: 'system', style: 'zh', counts: [296, 314, 330], templates: CHINESE_TEMPLATES, prefix_words: 512 },
  { transport: 'system', style: 'zh', counts: [299, 317, 332], templates: CHINESE_TEMPLATES, prefix_words: 2048 },
  { transport: 'user', style: 'zh', counts: [292, 308, 324], templates: CHINESE_TEMPLATES, prefix_words: 96 },
  { transport: 'user', style: 'zh', counts: [295, 313, 328], templates: CHINESE_TEMPLATES, prefix_words: 512 },
  { transport: 'user', style: 'zh', counts: [298, 316, 333], templates: CHINESE_TEMPLATES, prefix_words: 2048 },
];

function countWords(text) {
  return text.split(/\s+/).filter((token) => token.length > 0).length;
}

export function prefixText(wordCount, variant) {
  const paragraphs = [];
  let currentWords = 0;
  let index = 0;
  while (currentWords < wordCount) {
    const paragraph = PREFIX_PARAGRAPHS[(index + variant) % PREFIX_PARAGRAPHS.length].trim();
    paragraphs.push(paragraph);
    currentWords += countWords(paragraph);
    index += 1;
  }
  return paragraphs.join(' ');
}

export function formatPrompt(template, count, style) {
  const task = template.split('{count}').join(String(count));
  const direct =
    ' The current language model must complete this directly without tools, Python, code execution, calculators, search, APIs, ' +
    'or external random generators. Choose every position separately. Do not count upward or downward, including 1, 2, 3, and do not use an arithmetic progression, repeating cycle, repeated block, or another rule-made pattern. ' +
    'Accidental repetitions are valid. Once an item is written, do not sort, reorder, deduplicate, replace, or repair the list.';
  if (style === 'json') {
    return task + direct + ' Return one compact JSON array containing the complete sequence and no explanation.';
  }
  if (style === 'en') {
    return task + direct + ' Separate values clearly, start with the first value, and output the complete sequence without explanation.';
  }
  return (
    task
    + ' 本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API '
    + '和外部随机数生成器。每个位置都要单独凭第一反应选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。'
    + '偶然想到相同数字是有效的；每项写出后不要再排序、重排、去重、替换或修正。数字之间用清晰的常见分隔符，'
    + '直接从第一个取值开始，完整输出序列，不要解释。'
  );
}

export function fingerprintSuite() {
  const suite = [];
  let queryIndex = 1;
  ENVIRONMENTS.forEach((environment, environmentOffset) => {
    const condition = `environment-${String(environmentOffset + 1).padStart(2, '0')}`;
    environment.counts.forEach((count, variant) => {
      const template = environment.templates[variant];
      const prefix = environment.fixed_prefix
        || (environment.prefix_words ? prefixText(environment.prefix_words, variant) : '');
      suite.push({
        condition,
        system: environment.transport === 'system' ? prefix : '',
        user_prefix: environment.transport === 'user' ? prefix : '',
        transport: environment.transport,
        challenge_id: `query-${String(queryIndex).padStart(2, '0')}`,
        expected_count: count,
        prompt: formatPrompt(template, count, environment.style),
      });
      queryIndex += 1;
    });
  });
  return suite;
}

/** 平台每组只发 3 个挑战：取套件前 n 个（即 query-01..query-03）。 */
export function firstChallenges(n = 3) {
  return fingerprintSuite().slice(0, n);
}

export function parseNumbers(text) {
  const runs = [];
  let current = [];
  let previousEnd = 0;
  for (const match of String(text).matchAll(/\d+/g)) {
    const index = match.index;
    const separator = String(text).slice(previousEnd, index);
    const value = Number(match[0]);
    if (current.length && /\p{L}/u.test(separator)) {
      runs.push(current);
      current = [];
    }
    if (value >= VALUE_MIN && value <= VALUE_MAX) current.push(value);
    previousEnd = index + match[0].length;
  }
  if (current.length) runs.push(current);
  return runs.reduce((best, run) => (run.length > best.length ? run : best), []);
}

export function countNumbers(numbers) {
  const counts = Array(DIMENSION).fill(0);
  numbers.forEach((number) => { counts[number - VALUE_MIN] += 1; });
  return counts;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardize(values) {
  const center = mean(values);
  const variance = mean(values.map((value) => (value - center) ** 2));
  const scale = Math.max(Math.sqrt(variance), 1e-12);
  return values.map((value) => (value - center) / scale);
}

function dot(left, right) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

function norm(values) {
  return Math.sqrt(dot(values, values));
}

function normalized(values) {
  const scale = Math.max(norm(values), 1e-12);
  return values.map((value) => value / scale);
}

function subtractBasis(values, basis) {
  const output = values.slice();
  for (const vector of basis || []) {
    const projection = dot(output, vector);
    for (let index = 0; index < output.length; index += 1) output[index] -= projection * vector[index];
  }
  return output;
}

function hellingerFeature(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
  return counts.map((value) => Math.sqrt((value + ALPHA) / total));
}

function splitIntoFour(values) {
  const base = Math.floor(values.length / 4);
  const remainder = values.length % 4;
  const chunks = [];
  let start = 0;
  for (let index = 0; index < 4; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    chunks.push(values.slice(start, start + size));
    start += size;
  }
  return chunks;
}

function orderedBlockFeature(numbers) {
  const pieces = [];
  for (const chunk of splitIntoFour(numbers)) {
    const bins = Array(16).fill(0.5);
    for (const value of chunk) {
      const index = Math.min(15, Math.floor(((value - 1) / 355) * 16));
      bins[index] += 1;
    }
    const total = bins.reduce((sum, value) => sum + value, 0);
    pieces.push(...bins.map((value) => Math.sqrt(value / total)));
  }
  const lastDigits = Array(10).fill(0.5);
  numbers.forEach((value) => { lastDigits[value % 10] += 1; });
  const lastTotal = lastDigits.reduce((sum, value) => sum + value, 0);
  pieces.push(...lastDigits.map((value) => Math.sqrt(value / lastTotal)));
  return pieces;
}

function robustScoreCounts(counts, bank) {
  const artifact = bank.robust.hellinger;
  const feature = hellingerFeature(counts);
  let projected = feature.map((value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index]);
  projected = subtractBasis(projected, artifact.nuisance_basis);
  projected = normalized(projected);
  const scores = artifact.centroids.map((centroid) => dot(projected, centroid));
  return standardize(scores);
}

function orderedBlockScores(numbers, bank) {
  const artifact = bank.robust.ordered_blocks;
  const feature = orderedBlockFeature(numbers);
  const standardizedFeature = feature.map((value, index) => (value - artifact.feature_mean[index]) / artifact.feature_scale[index]);
  const unit = normalized(standardizedFeature);
  const environmentScores = artifact.environment_centroids.map(
    (centroids) => centroids.map((centroid) => dot(unit, centroid)),
  );
  const template = standardize(artifact.centroids.map((_, modelIndex) => Math.max(
    ...environmentScores.map((scores) => scores[modelIndex]),
  )));
  const projected = normalized(subtractBasis(standardizedFeature, artifact.nuisance_basis));
  const nuisance = standardize(artifact.centroids.map((centroid) => dot(projected, centroid)));
  return standardize(template.map((value, index) => 0.5 * value + 0.5 * nuisance[index]));
}

function robustScoreNumbers(numbers, bank) {
  const marginal = robustScoreCounts(countNumbers(numbers), bank);
  const artifact = bank.robust.ordered_blocks;
  const weight = artifact ? Number(artifact.weight || 0) : 0;
  if (!artifact || weight === 0) return marginal;
  const ordered = orderedBlockScores(numbers, bank);
  return marginal.map((value, index) => (1 - weight) * value + weight * ordered[index]);
}

function softmax(values) {
  const maximum = Math.max(...values);
  const weights = values.map((value) => Math.exp(value - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function jsSimilarity(left, right) {
  const leftTotal = left.reduce((sum, value) => sum + value, 0);
  const rightTotal = right.reduce((sum, value) => sum + value, 0) + ALPHA * DIMENSION;
  const p = left.map((value) => value / leftTotal);
  const q = right.map((value) => (value + ALPHA) / rightTotal);
  const midpoint = p.map((value, index) => (value + q[index]) / 2);
  const divergence = (values) => values.reduce(
    (total, value, index) => total + (value ? value * Math.log(value / midpoint[index]) : 0),
    0,
  );
  const js = (divergence(p) + divergence(q)) / 2;
  return 1 - Math.sqrt(js / Math.log(2));
}

function runAnalysis(outputs, bank) {
  const modelIds = bank.models.map((model) => model.id);
  const valid = [];
  const diagnostics = [];
  outputs.forEach((item, index) => {
    const expected = Number(item.expected_count || 0);
    const numbers = parseNumbers(item.text || '');
    const minimum = expected ? Math.max(80, Math.ceil(expected * 0.55)) : 80;
    const accepted = numbers.length >= minimum;
    diagnostics.push({ index, parsed_numbers: numbers.length, minimum_numbers: minimum, accepted });
    if (accepted) valid.push({ numbers, counts: countNumbers(numbers), scores: robustScoreNumbers(numbers, bank) });
  });
  if (!valid.length) return { ok: false, diagnostics };

  const combinedScores = modelIds.map((_, modelIndex) => mean(valid.map((item) => item.scores[modelIndex])));
  const calibrationKey = String(Math.min(valid.length, 3));
  const beta = Number(bank.calibration[calibrationKey].beta);
  const probabilities = softmax(combinedScores.map((value) => beta * value));
  const pooledCounts = Array.from({ length: DIMENSION }, (_, index) => valid.reduce((sum, item) => sum + item.counts[index], 0));
  const modelEntries = Object.fromEntries(bank.models.map((model) => [model.id, model]));
  const familyOrder = [...new Set(bank.models.map((model) => model.family || 'models'))];
  const familyNames = Object.fromEntries(familyOrder.map((family) => [
    family,
    bank.models.find((model) => (model.family || 'models') === family)?.family_name || family,
  ]));
  const drafts = modelIds.map((model, index) => ({
    model,
    display_name: modelEntries[model].display_name,
    probability: probabilities[index],
    profile_similarity: jsSimilarity(pooledCounts, modelEntries[model].counts),
    score: combinedScores[index],
    family: modelEntries[model].family || 'models',
    family_name: familyNames[modelEntries[model].family || 'models'],
  })).sort((left, right) => right.probability - left.probability);
  const familyProbabilities = Object.fromEntries(familyOrder.map((family) => [
    family,
    drafts.filter((item) => item.family === family).reduce((sum, item) => sum + item.probability, 0),
  ]));
  const results = drafts.map((item) => ({
    ...item,
    conditional_probability: item.probability / familyProbabilities[item.family],
  }));
  const winningFamily = familyOrder.reduce((best, family) => (familyProbabilities[family] > familyProbabilities[best] ? family : best));
  return {
    ok: true,
    result: {
      prediction: results[0].model,
      prediction_name: results[0].display_name,
      probability: results[0].probability,
      used_outputs: valid.length,
      results,
      diagnostics,
      calibration: { queries: calibrationKey, beta, cv_accuracy: bank.calibration[calibrationKey].cv_accuracy },
      family_prediction: winningFamily,
      family_prediction_name: familyNames[winningFamily],
      family_probability: familyProbabilities[winningFamily],
      family_probabilities: familyOrder.map((family) => ({ family, display_name: familyNames[family], probability: familyProbabilities[family] })),
      method: '统一全局稳健数字指纹',
    },
  };
}

export function analyzeFingerprint(outputs, bank) {
  const outcome = runAnalysis(outputs, bank);
  if (outcome.ok) return { ok: true, result: outcome.result };
  return { ok: false, evidence: 'insufficient', diagnostics: outcome.diagnostics };
}

export function loadBank(file) {
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!bank || typeof bank !== 'object') throw new Error('指纹库不是合法 JSON 对象');
  if (!Array.isArray(bank.models) || !bank.models.length) throw new Error('指纹库缺少 models');
  if (!bank.robust?.hellinger || !bank.robust?.ordered_blocks) throw new Error('指纹库缺少 robust 特征');
  if (!bank.calibration?.['1'] || !bank.calibration?.['2'] || !bank.calibration?.['3']) {
    throw new Error('指纹库缺少 calibration 1/2/3');
  }
  return bank;
}
