/**
 * OpenAI Chat Completions 传输层（零依赖，Node 内置 fetch）。
 *
 * - 只追加 `/chat/completions`，不自动增删 `/v1`、不试探多个 URL；
 * - 不跟随 3xx；不把密钥写入任何返回对象；
 * - 连接 / 首内容 / 内容间隔 / 总时限分别计时；
 * - 失败按配置重试（默认 1 次）；每次尝试的原始响应由调用方落盘。
 */
import { SseDecoder } from './sse.mjs';
import { sleep, truncate } from './util.mjs';

export const DEFAULT_TIMEOUTS = {
  connect: 15_000,
  first: 300_000,
  gap: 120_000,
  total: 900_000,
};

const RAW_LIMIT = 16 * 1024 * 1024;
const BYTE_LIMIT = 32 * 1024 * 1024;

export class ChatError extends Error {
  constructor(category, message, retryable = false) {
    super(message);
    this.name = 'ChatError';
    this.category = category;
    this.retryable = retryable;
  }
}

export function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
}

export function buildBody({ model, prompt, systemPrompt = null, maxTokens = null, stream = true }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  const body = {
    model,
    messages,
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  // 默认不发送 max_tokens：输出上限交给上游；只有显式指定时才加限制。
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  return body;
}

function cleanSnippet(text, limit = 600) {
  return truncate(String(text ?? '').replace(/\s+/g, ' ').trim(), limit);
}

/** 把上游 HTTP 错误翻译成可执行的中文提示。 */
export function classifyHttpError(status, text) {
  const snippet = cleanSnippet(text);
  if (status === 401 || status === 403) {
    return {
      category: 'auth_error',
      message: `鉴权失败 HTTP ${status}：${snippet || '密钥无效或无权限'}`,
      retryable: false,
    };
  }
  if (status === 429) {
    if (/all available accounts exhausted|no available accounts|account pool/i.test(text)) {
      return {
        category: 'upstream_exhausted',
        message: '中转站无可用上游账号（All available accounts exhausted）；请等站方恢复，或换一个有账号的分组。',
        retryable: true,
      };
    }
    return {
      category: 'rate_limited',
      message: `上游限流 HTTP 429：${snippet}`,
      retryable: true,
    };
  }
  if (status === 502 || status === 503 || status === 504) {
    const why = status === 502
      ? '中转站源站 502（Cloudflare 未从源站拿到有效响应，常见于中转站过载或上游故障）'
      : status === 503
        ? '中转站暂时不可用（503）'
        : '中转站源站响应超时（504）';
    return {
      category: 'upstream_5xx',
      message: `${why}；这是中转站侧的问题，不是本平台故障。${snippet ? `响应：${snippet}` : ''}`,
      retryable: true,
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      category: 'upstream_5xx',
      message: `中转站/上游返回 HTTP ${status}：${snippet}`,
      retryable: true,
    };
  }
  if (status >= 300 && status < 400) {
    return {
      category: 'redirect_blocked',
      message: `上游返回重定向 HTTP ${status}（已禁用自动跟随）：${snippet}`,
      retryable: false,
    };
  }
  if (status === 400 || status === 422) {
    if (/max_tokens|max_output_tokens|max_completion_tokens|temperature|top_p|reasoning|unsupported (parameter|value)|unknown parameter|invalid_type|not (supported|allowed)|too large|context_length|invalid_request_error/i.test(text)) {
      return {
        category: 'param_rejected',
        message: `参数被拒绝 HTTP ${status}：${snippet}`,
        retryable: false,
      };
    }
    return {
      category: 'http_error',
      message: `请求被拒绝 HTTP ${status}：${snippet}`,
      retryable: false,
    };
  }
  return {
    category: 'http_error',
    message: `上游返回 HTTP ${status}：${snippet}`,
    retryable: false,
  };
}

export function classifyProviderError(text) {
  const snippet = cleanSnippet(text);
  if (/all available accounts exhausted|no available accounts|account pool/i.test(text)) {
    return {
      category: 'upstream_exhausted',
      message: '中转站无可用上游账号（All available accounts exhausted）；请等站方恢复，或换一个有账号的分组。',
      retryable: true,
    };
  }
  if (/rate limit|too many requests|429/i.test(text)) {
    return {
      category: 'rate_limited',
      message: `上游限流：${snippet}`,
      retryable: true,
    };
  }
  return {
    category: 'upstream_error',
    message: `上游返回错误：${snippet || '未知错误'}`,
    retryable: true,
  };
}

function classifyFetchError(err, abortReason, timeouts) {
  if (abortReason === 'cancelled') {
    return { category: 'cancelled', message: '请求已取消', retryable: false };
  }
  if (abortReason === 'connect_timeout') {
    return {
      category: 'connect_timeout',
      message: `连接超时（${timeouts.connect}ms）`,
      retryable: true,
    };
  }
  if (abortReason === 'first_content_timeout') {
    return {
      category: 'first_content_timeout',
      message: `首内容等待超时（${timeouts.first}ms）`,
      retryable: true,
    };
  }
  if (abortReason === 'content_gap_timeout') {
    return {
      category: 'content_gap_timeout',
      message: `内容间隔超时（${timeouts.gap}ms）`,
      retryable: true,
    };
  }
  if (abortReason === 'total_timeout') {
    return {
      category: 'total_timeout',
      message: `总时限超时（${timeouts.total}ms）`,
      retryable: true,
    };
  }
  if (abortReason === 'output_limit') {
    return { category: 'output_limit', message: '响应超过保护阈值，已中止', retryable: false };
  }

  const name = err?.name || '';
  const code = err?.code || err?.cause?.code || err?.cause?.errno || '';
  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return { category: 'cancelled', message: '请求已取消', retryable: false };
  }
  if (code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { category: 'connect_timeout', message: `连接超时（${timeouts.connect}ms）`, retryable: true };
  }
  if (code === 'UND_ERR_HEADERS_TIMEOUT') {
    return { category: 'first_content_timeout', message: `首内容等待超时（${timeouts.first}ms）`, retryable: true };
  }
  if (code === 'UND_ERR_BODY_TIMEOUT') {
    return { category: 'content_gap_timeout', message: `内容间隔超时（${timeouts.gap}ms）`, retryable: true };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { category: 'dns_error', message: `域名解析失败：${code}`, retryable: true };
  }
  if (code === 'ECONNREFUSED') {
    return { category: 'connection_refused', message: '连接被拒绝（ECONNREFUSED）', retryable: true };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return { category: 'connection_reset', message: `连接被重置（${code}）`, retryable: true };
  }
  if (code === 'ETIMEDOUT') {
    return { category: 'connect_timeout', message: `连接超时（${timeouts.connect}ms）`, retryable: true };
  }
  if (/CERT_|TLS|SSL|self.signed|altname/i.test(String(code)) || /certificate|TLS|SSL/i.test(String(err?.message))) {
    return { category: 'tls_error', message: `TLS/证书错误：${code || err?.message}`, retryable: false };
  }
  const detail = err?.cause?.message || err?.message || String(err);
  return { category: 'network_error', message: `网络错误：${detail}`, retryable: true };
}

function mapUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const details = raw.completion_tokens_details || raw.output_tokens_details || {};
  return {
    input: raw.prompt_tokens ?? raw.input_tokens ?? null,
    output: raw.completion_tokens ?? raw.output_tokens ?? null,
    total: raw.total_tokens ?? null,
    reasoning: details.reasoning_tokens ?? null,
    raw,
  };
}

async function readBodyLimited(res, limit = 8192) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size < limit) {
        const remain = limit - size;
        chunks.push(value.byteLength > remain ? value.slice(0, remain) : value);
        size += Math.min(value.byteLength, remain);
      }
      if (size >= limit) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
    }
  } catch {
    // 错误体读取失败时返回已读部分
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

function timeoutResult({ url, body, startedAt, timeouts, error, raw = '', httpStatus = null, contentType = '' }) {
  return {
    ok: false,
    url,
    requestBody: body,
    httpStatus,
    contentType,
    content: '',
    reasoning: '',
    usage: null,
    finishReason: null,
    raw,
    warnings: [],
    error,
    timings: {
      startedAt: new Date(startedAt).toISOString(),
      headersMs: null,
      firstContentMs: null,
      totalMs: Date.now() - startedAt,
      generationMs: null,
      speedTps: null,
      speedCps: null,
      nonStream: false,
    },
  };
}

export async function runChatOnce({
  baseUrl,
  apiKey,
  model,
  prompt,
  systemPrompt = null,
  maxTokens = null,
  timeouts = DEFAULT_TIMEOUTS,
  externalSignal = null,
  attempt = 1,
}) {
  const url = chatCompletionsUrl(baseUrl);
  const body = buildBody({ model, prompt, systemPrompt, maxTokens, stream: true });
  const startedAt = Date.now();
  const controller = new AbortController();
  let abortReason = null;
  const timers = new Set();

  const setTimer = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timers.add(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(timer);
  };
  const clearAllTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  const abort = (reason) => {
    if (controller.signal.aborted) return;
    abortReason = reason;
    controller.abort();
  };
  const onExternalAbort = () => abort('cancelled');
  if (externalSignal) {
    if (externalSignal.aborted) {
      return timeoutResult({
        url,
        body,
        startedAt,
        timeouts,
        error: { category: 'cancelled', message: '请求已取消', retryable: false },
      });
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const totalTimer = setTimer(() => abort('total_timeout'), timeouts.total);
  const connectTimer = setTimer(() => abort('connect_timeout'), timeouts.connect);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'fine-apitest/0.1 (local capability testing)',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearAllTimers();
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    return timeoutResult({
      url,
      body,
      startedAt,
      timeouts,
      error: classifyFetchError(err, abortReason, timeouts),
    });
  }

  clearTimer(connectTimer);
  const headersMs = Date.now() - startedAt;
  const contentType = res.headers.get('content-type') || '';
  const httpStatus = res.status;

  if (!res.ok) {
    const text = await readBodyLimited(res);
    clearAllTimers();
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    return timeoutResult({
      url,
      body,
      startedAt,
      timeouts,
      error: classifyHttpError(httpStatus, text),
      raw: text,
      httpStatus,
      contentType,
    });
  }

  let firstContentTimer = setTimer(() => abort('first_content_timeout'), timeouts.first);
  let gapTimer = null;
  let firstContentAt = null;
  let content = '';
  let reasoning = '';
  let usage = null;
  let finishReason = null;
  let sawDone = false;
  let sawFinish = false;
  let streamIncomplete = false;
  let raw = '';
  let bytes = 0;
  let rawTruncated = false;
  const rawDecoder = new TextDecoder('utf-8');
  const warnings = [];

  const markFirst = () => {
    if (firstContentAt) return;
    firstContentAt = Date.now();
    clearTimer(firstContentTimer);
    firstContentTimer = null;
    gapTimer = setTimer(() => abort('content_gap_timeout'), timeouts.gap);
  };
  const resetGap = () => {
    if (!gapTimer) return;
    clearTimer(gapTimer);
    gapTimer = setTimer(() => abort('content_gap_timeout'), timeouts.gap);
  };
  const appendRaw = (chunk) => {
    if (rawTruncated) return;
    if (raw.length + chunk.length > RAW_LIMIT) {
      raw += chunk.slice(0, Math.max(0, RAW_LIMIT - raw.length));
      rawTruncated = true;
      warnings.push('raw_truncated');
      return;
    }
    raw += chunk;
  };

  const handleJson = (obj) => {
    if (obj?.error) {
      const cls = classifyProviderError(JSON.stringify(obj.error));
      throw new ChatError(cls.category, cls.message, cls.retryable);
    }
    const choice = obj?.choices?.[0];
    const delta = choice?.delta || choice?.message || {};
    const r = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
    const c = delta.content;
    if (typeof r === 'string' && r) {
      reasoning += r;
      markFirst();
      resetGap();
    }
    if (typeof c === 'string' && c) {
      content += c;
      markFirst();
      resetGap();
    }
    if (obj?.usage) usage = mapUsage(obj.usage);
    if (choice?.finish_reason) {
      sawFinish = true;
      finishReason = choice.finish_reason;
    }
  };

  let parsedAsSse = contentType.includes('text/event-stream');

  const handleSseMessage = (msg) => {
    if (msg.comment) return;
    const data = msg.data.trim();
    if (!data) return;
    if (data === '[DONE]') {
      sawDone = true;
      return;
    }
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      throw new ChatError('invalid_stream', `SSE data 不是合法 JSON：${cleanSnippet(data, 200)}`, true);
    }
    handleJson(obj);
  };

  try {
    if (parsedAsSse) {
      const reader = res.body.getReader();
      const dec = new SseDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > BYTE_LIMIT) {
          abort('output_limit');
          break;
        }
        appendRaw(rawDecoder.decode(value, { stream: true }));
        for (const msg of dec.push(value)) handleSseMessage(msg);
      }
      appendRaw(rawDecoder.decode());
      for (const msg of dec.end()) handleSseMessage(msg);
      if (!sawFinish && !sawDone) {
        streamIncomplete = true;
        warnings.push('stream_incomplete');
      }
    } else {
      // 有些中转站不返回 text/event-stream，但仍输出 SSE；先按文本判断。
      const text = await readBodyLimited(res, BYTE_LIMIT);
      appendRaw(text);
      if (/^\s*data:/m.test(text) || text.includes('\n\ndata:')) {
        parsedAsSse = true;
        const dec = new SseDecoder();
        for (const msg of dec.push(Buffer.from(text))) handleSseMessage(msg);
        for (const msg of dec.end()) handleSseMessage(msg);
        if (!sawFinish && !sawDone) {
          streamIncomplete = true;
          warnings.push('stream_incomplete');
        }
        firstContentAt = firstContentAt || Date.now();
        clearTimer(firstContentTimer);
        firstContentTimer = null;
      } else {
        // 非流式 JSON：完整响应到达才算首内容，TTFT 不可测。
        let obj;
        try {
          obj = JSON.parse(text);
        } catch {
          throw new ChatError('invalid_stream', '非流式响应不是合法 JSON', true);
        }
        handleJson(obj);
        firstContentAt = Date.now();
        clearTimer(firstContentTimer);
        firstContentTimer = null;
        warnings.push('non_stream');
      }
    }
  } catch (err) {
    clearAllTimers();
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    const error = err instanceof ChatError
      ? { category: err.category, message: err.message, retryable: err.retryable }
      : classifyFetchError(err, abortReason, timeouts);
    return {
      ...timeoutResult({ url, body, startedAt, timeouts, error, raw, httpStatus, contentType }),
      content,
      reasoning,
      usage,
      finishReason,
      warnings,
      timings: {
        startedAt: new Date(startedAt).toISOString(),
        headersMs,
        firstContentMs: firstContentAt ? firstContentAt - startedAt : null,
        totalMs: Date.now() - startedAt,
        generationMs: firstContentAt ? Date.now() - firstContentAt : null,
        speedTps: null,
        speedCps: null,
        nonStream: !parsedAsSse,
      },
    };
  } finally {
    clearAllTimers();
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }

  if (abortReason) {
    const finishedAt = Date.now();
    const error = classifyFetchError(new Error('aborted'), abortReason, timeouts);
    return {
      ...timeoutResult({ url, body, startedAt, timeouts, error, raw, httpStatus, contentType }),
      content,
      reasoning,
      usage,
      finishReason,
      warnings,
      timings: {
        startedAt: new Date(startedAt).toISOString(),
        headersMs,
        firstContentMs: firstContentAt ? firstContentAt - startedAt : null,
        totalMs: finishedAt - startedAt,
        generationMs: firstContentAt ? finishedAt - firstContentAt : null,
        speedTps: null,
        speedCps: null,
        nonStream: !parsedAsSse,
      },
    };
  }

  const finishedAt = Date.now();
  const totalMs = finishedAt - startedAt;
  const generationMs = firstContentAt ? finishedAt - firstContentAt : null;
  const timings = {
    startedAt: new Date(startedAt).toISOString(),
    headersMs,
    firstContentMs: firstContentAt ? firstContentAt - startedAt : null,
    totalMs,
    generationMs,
    speedTps: generationMs && usage?.output ? (usage.output / (generationMs / 1000)) : null,
    speedCps: generationMs && content.length ? (content.length / (generationMs / 1000)) : null,
    nonStream: !parsedAsSse,
  };

  if (!content.trim()) {
    return {
      ok: false,
      url,
      requestBody: body,
      httpStatus,
      contentType,
      content,
      reasoning,
      usage,
      finishReason,
      raw,
      warnings,
      error: { category: 'empty_response', message: '上游返回 200，但正文为空', retryable: true },
      timings,
    };
  }

  return {
    ok: true,
    url,
    requestBody: body,
    httpStatus,
    contentType,
    content,
    reasoning,
    usage,
    finishReason,
    raw,
    warnings,
    error: null,
    timings,
  };
}

export async function runChatWithRetry(options) {
  const retries = Math.max(0, Number(options.retry ?? 1));
  const attempts = [];
  let last = null;
  for (let index = 0; index <= retries; index += 1) {
    const result = await runChatOnce({ ...options, attempt: index + 1 });
    const attempt = {
      attempt: index + 1,
      ok: result.ok,
      httpStatus: result.httpStatus,
      error: result.error,
      timings: result.timings,
      finishReason: result.finishReason,
      warnings: result.warnings,
      raw: result.raw,
    };
    attempts.push(attempt);
    if (options.onAttempt) {
      try {
        await options.onAttempt(result, attempt);
      } catch {
        // 落盘失败不应中断测试
      }
    }
    last = result;
    if (result.ok) break;
    if (result.error?.category === 'cancelled') break;
    if (index < retries) await sleep(1200);
  }
  return { ...last, attempts };
}
