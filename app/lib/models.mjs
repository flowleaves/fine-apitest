/**
 * GET /models 自动发现模型。
 * 只读取模型列表，不写入任何渠道配置。
 */
import { classifyHttpError } from './chat.mjs';
import { assertSafeTarget } from './netguard.mjs';

export class ModelDiscoveryError extends Error {
  constructor(message, category = 'model_discovery_error', status = null) {
    super(message);
    this.name = 'ModelDiscoveryError';
    this.category = category;
    this.status = status;
  }
}

export async function discoverModels({ baseUrl, apiKey, allowPrivate = false, timeoutMs = 30_000 }) {
  const target = await assertSafeTarget(baseUrl, { allowPrivate });
  const url = `${target.url.replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'fine-apitest/0.1 (local capability testing)',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const cls = classifyHttpError(res.status, text);
      throw new ModelDiscoveryError(`获取模型列表失败：${cls.message}`, cls.category, res.status);
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new ModelDiscoveryError('模型列表不是合法 JSON', 'invalid_response', res.status);
    }
    const arr = Array.isArray(obj?.data) ? obj.data : Array.isArray(obj?.models) ? obj.models : [];
    const ids = arr
      .map((item) => (typeof item === 'string' ? item : item?.id))
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim());
    const models = [...new Set(ids)];
    if (!models.length) {
      throw new ModelDiscoveryError('模型列表为空：该密钥可能没有可用模型，或站点未实现 /models', 'empty_models', res.status);
    }
    return { models, raw: obj, status: res.status, url };
  } catch (err) {
    if (err instanceof ModelDiscoveryError) throw err;
    if (err?.name === 'AbortError') {
      throw new ModelDiscoveryError(`获取模型列表超时（${timeoutMs}ms）`, 'model_discovery_timeout');
    }
    const code = err?.cause?.code || err?.code || '';
    throw new ModelDiscoveryError(`获取模型列表失败：${code || err?.message || err}`, 'model_discovery_error');
  } finally {
    clearTimeout(timer);
  }
}
