export function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('AI Server URL은 http 또는 https만 허용합니다.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function identifyServerTarget(baseUrl, targets) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return targets.find((target) => normalizeBaseUrl(target.url) === normalizedBaseUrl)?.id ?? 'custom';
}

export function renderPath(template, params = {}) {
  const rendered = template.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key) => {
    const value = params[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`경로 파라미터 ${key}가 필요합니다.`);
    }
    return encodeURIComponent(String(value));
  });
  if (rendered.includes('..') || rendered.includes('://')) {
    throw new Error('유효하지 않은 API 경로입니다.');
  }
  return rendered;
}

export function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

export function evaluateExpectation(result, expectation = {}) {
  const statuses = expectation.statuses ?? [200];
  const reasons = [];
  if (!statuses.includes(result.status)) {
    reasons.push(`status ${result.status}, expected ${statuses.join('/')}`);
  }
  if (expectation.bodyIncludes) {
    const serialized = JSON.stringify(result.body);
    if (!serialized.includes(expectation.bodyIncludes)) {
      reasons.push(`body does not include ${expectation.bodyIncludes}`);
    }
  }
  if (expectation.correlationId && !result.headers?.correlationId) {
    reasons.push('x-correlation-id is missing');
  }
  return { passed: reasons.length === 0, reasons };
}

export function collectTotalTokens(body) {
  if (!body || typeof body !== 'object') return 0;
  if (typeof body.totalTokens === 'number') return body.totalTokens;
  if (typeof body.totaltokens === 'number') return body.totaltokens;
  if (body.usage) return collectTotalTokens(body.usage);
  return 0;
}
