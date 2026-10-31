/**
 * HTML artifact 提取与结构检查。
 *
 * 只做「能不能用」的硬检查：完整标签、无外链、内嵌 SVG、动画、速度滑块、
 * 暂停/继续按钮、「星芽」标识、viewport 等。
 * 水豚形象、墨镜、海滩构图、动画协调等视觉质量由 Agent 打开产物后复核，
 * 代码不假装能看懂画面。
 */

const EXTERNAL_PATTERNS = [
  { id: 'script-src', re: /<script[^>]+\bsrc\s*=\s*["']?https?:/i, label: '外链 <script src>' },
  { id: 'link-href', re: /<link[^>]+\bhref\s*=\s*["']?https?:/i, label: '外链 <link href>' },
  { id: 'img-src', re: /<img[^>]+\bsrc\s*=\s*["']?https?:/i, label: '外链 <img src>' },
  { id: 'svg-resource', re: /<(?:use|image|feImage)\b[^>]+\b(?:xlink:)?href\s*=\s*["']?https?:/i, label: 'SVG 外链资源' },
  { id: 'iframe-src', re: /<iframe[^>]+\bsrc\s*=\s*["']?https?:/i, label: '外链 <iframe src>' },
  { id: 'media-src', re: /<(?:video|audio|source|track|embed)[^>]+\bsrc\s*=\s*["']?https?:/i, label: '外链媒体资源' },
  { id: 'object-data', re: /<object[^>]+\bdata\s*=\s*["']?https?:/i, label: '外链 <object data>' },
  { id: 'srcset', re: /\bsrcset\s*=\s*["'][^"']*https?:/i, label: '外链 srcset' },
  { id: 'css-url', re: /url\(\s*["']?https?:/i, label: 'CSS url(http...)' },
  { id: 'css-import', re: /@import\b/i, label: 'CSS @import' },
  { id: 'fetch', re: /\bfetch\s*\(/i, label: '运行时 fetch()' },
  { id: 'xhr', re: /XMLHttpRequest/i, label: 'XMLHttpRequest' },
  { id: 'protocol-relative', re: /\b(?:src|href)\s*=\s*["']\/\//i, label: '协议相对外链' },
];

function lineCount(text) {
  return String(text).split('\n').length;
}

function findFencedBlock(text, rootPattern) {
  const blocks = [...String(text).matchAll(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/g)];
  const candidates = blocks
    .map((match) => match[1].trim())
    .filter((block) => rootPattern.test(block));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.length - a.length)[0];
}

export function extractHtml(text) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) return { artifact: '', mode: 'none', hasClosing: false };
  const fenced = findFencedBlock(body, /<html[\s>]|<!doctype\s+html/i);
  if (fenced) {
    const lower = fenced.toLowerCase();
    const doctype = lower.indexOf('<!doctype html');
    const html = lower.indexOf('<html');
    const start = doctype >= 0 ? doctype : html >= 0 ? html : 0;
    const artifact = fenced.slice(start).trim();
    return { artifact, mode: 'fence', hasClosing: /<\/html>\s*$/i.test(artifact) };
  }
  const lower = body.toLowerCase();
  const doctype = lower.indexOf('<!doctype html');
  const html = lower.indexOf('<html');
  const start = doctype >= 0 ? doctype : html >= 0 ? html : -1;
  if (start < 0) return { artifact: '', mode: 'none', hasClosing: false };
  const close = lower.lastIndexOf('</html>');
  const artifact = close >= start ? body.slice(start, close + 7).trim() : body.slice(start).trim();
  return { artifact, mode: 'inline', hasClosing: close >= start };
}

function externalRefs(artifact) {
  const hits = [];
  for (const pattern of EXTERNAL_PATTERNS) {
    if (pattern.re.test(artifact)) hits.push(pattern.label);
  }
  return hits;
}

function isTruncated(finishReason, hasClosing) {
  if (!hasClosing) return true;
  return /length|max_tokens|max_output|incomplete|truncat/i.test(String(finishReason || ''));
}

function buildCheck(id, label, ok, critical, detail = '') {
  return { id, label, ok: Boolean(ok), critical: Boolean(critical), detail: String(detail || '') };
}

function attrNumber(tag, name) {
  if (!tag) return null;
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']?([\\d.]+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function findRangeInput(artifact) {
  const tags = [...artifact.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
  return tags.find((tag) => /type\s*=\s*["']range["']/i.test(tag)) || null;
}

function hasPauseButton(artifact) {
  const buttonText = /<button\b[^>]*>[\s\S]{0,300}?(暂停|继续|播放|pause|resume|play|⏸|⏵|▶|⏯)[\s\S]{0,300}?<\/button>/i.test(artifact);
  const buttonAttr = /<button[^>]*(?:id|class|aria-label|title)\s*=\s*["'][^"']*(?:pause|resume|play|暂停|继续)[^"']*["']/i.test(artifact);
  return buttonText || buttonAttr;
}

export function evaluateArtifact(text, kind, { finishReason = null, maxTokens = null } = {}) {
  if (kind !== 'html') {
    throw new Error(`不支持的 artifact 类型：${kind}`);
  }
  const extracted = extractHtml(text);
  const artifact = extracted.artifact;
  const bytes = Buffer.byteLength(artifact, 'utf8');
  const lines = lineCount(artifact);
  const checks = [];

  if (!artifact) {
    return {
      verdict: 'fail',
      reason: '没有从回答中提取到完整 HTML 产物',
      artifact: '',
      mode: extracted.mode,
      bytes: 0,
      lines: 0,
      checks: [buildCheck('artifact', '提取到完整 HTML', false, true, '未找到 <html> 根标签')],
    };
  }

  const external = externalRefs(artifact);
  const truncated = isTruncated(finishReason, extracted.hasClosing);
  const hasHtml = /<html[\s>]/i.test(artifact);
  const hasBody = /<body[\s>]/i.test(artifact);
  const inlineSvg = (artifact.match(/<svg[\s>]/gi) || []).length;
  const hasAnimation = /@keyframes|<animate\b|<animateTransform|requestAnimationFrame|setInterval|animation\s*:/i.test(artifact);
  const hasScript = /<script\b/i.test(artifact);
  const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(artifact) || /@media\b/i.test(artifact);
  const rangeTag = findRangeInput(artifact);
  const rangeMin = attrNumber(rangeTag, 'min');
  const rangeMax = attrNumber(rangeTag, 'max');
  const coversSpeedRange = Boolean(rangeTag) && rangeMin !== null && rangeMax !== null && rangeMin <= 0.3 && rangeMax >= 3.0;
  const pauseButton = hasPauseButton(artifact);
  const hasBrand = /星芽/.test(artifact);
  const speedWired = /addEventListener\s*\(\s*["']input["']|oninput\s*=/i.test(artifact);
  const pauseWired = /addEventListener\s*\(\s*["']click["']|onclick\s*=/i.test(artifact);

  checks.push(buildCheck('html-root', '包含 <html> 根标签', hasHtml, true));
  checks.push(buildCheck('html-body', '包含 <body>', hasBody, true));
  checks.push(buildCheck('html-closing', '包含 </html> 结束标签', extracted.hasClosing, true));
  checks.push(buildCheck('inline-svg', '内嵌 SVG', inlineSvg > 0, true, `${inlineSvg} 个 <svg>`));
  checks.push(buildCheck('animation', '包含动画（CSS/SMIL/JS）', hasAnimation, true));
  checks.push(buildCheck('script', '包含 vanilla JavaScript', hasScript, true));
  checks.push(buildCheck(
    'speed-range',
    '速度滑块覆盖 0.3×–3.0×',
    coversSpeedRange,
    true,
    rangeTag ? `min=${rangeMin ?? '?'} max=${rangeMax ?? '?'}` : '未找到 <input type="range">',
  ));
  checks.push(buildCheck('pause-button', '包含暂停/继续按钮', pauseButton, true));
  checks.push(buildCheck('brand', '左上角「星芽」艺术字', hasBrand, true));
  checks.push(buildCheck('external', '不依赖外部资源', external.length === 0, true, external.join('、')));
  checks.push(buildCheck('truncated', '未被 max_tokens 截断', !truncated, true, finishReason ? `finish_reason=${finishReason}` : ''));
  checks.push(buildCheck('viewport', '移动端 viewport 或 @media', hasViewport, false));
  checks.push(buildCheck('speed-wired', '滑块已连接到动画更新', speedWired, false));
  checks.push(buildCheck('pause-wired', '按钮已连接到暂停/继续逻辑', pauseWired, false));
  checks.push(buildCheck('size', '产物大小合理（>2KB）', bytes > 2048, false, `${bytes}B / ${lines} 行`));

  const criticalFailed = checks.filter((check) => check.critical && !check.ok);
  const warnings = checks.filter((check) => !check.critical && !check.ok);
  const common = {
    artifact,
    mode: extracted.mode,
    bytes,
    lines,
    checks,
    truncated,
    external,
    maxTokens,
  };
  if (criticalFailed.length) {
    return {
      ...common,
      verdict: 'fail',
      reason: criticalFailed.map((check) => check.label).join('；'),
    };
  }
  if (warnings.length) {
    return {
      ...common,
      verdict: 'review',
      reason: warnings.map((check) => check.label).join('；'),
    };
  }
  return {
    ...common,
    verdict: 'ok',
    reason: '结构检查通过，等待视觉复核',
  };
}
