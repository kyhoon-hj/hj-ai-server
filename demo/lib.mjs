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

export function evaluateKnowledgeLifecycleStep(step, body, context = {}) {
  const reasons = [];
  const fileId = context.fileId;

  if (!body || typeof body !== 'object') {
    return ['response body is not an object'];
  }

  if (step === 'upload') {
    if (!body.id) reasons.push('uploaded file id is missing');
    if (body.status !== 'uploaded') reasons.push(`upload status is ${body.status ?? 'missing'}`);
  } else if (step === 'index' || step === 'reindex') {
    if (body.fileId !== fileId) reasons.push('indexed file id does not match upload');
    if (body.status !== 'indexed') reasons.push(`index status is ${body.status ?? 'missing'}`);
    if (!Number.isInteger(body.chunkCount) || body.chunkCount < 1) reasons.push('indexed chunk count is missing');
    if (Number.isInteger(context.expectedChunkCount) && body.chunkCount !== context.expectedChunkCount) {
      reasons.push(`chunk count ${body.chunkCount ?? 'missing'} does not match ${context.expectedChunkCount}`);
    }
  } else if (step === 'policy') {
    if (body.id !== fileId) reasons.push('policy file id does not match upload');
    if (body.accessLevel !== 'PUBLIC') reasons.push('access level is not PUBLIC');
    if (body.businessStatus !== 'PUBLISHED') reasons.push('business status is not PUBLISHED');
    if (!body.productCodes?.includes(context.productCode)) reasons.push('product code is not applied');
  } else if (step === 'search') {
    const match = body.matches?.find((candidate) => candidate.fileId === fileId);
    if (!match) reasons.push('uploaded file is missing from search matches');
    if (match && context.marker && !match.content?.includes(context.marker)) reasons.push('search match does not contain marker');
  } else if (step === 'answer') {
    if (body.answerable !== true) reasons.push('answer is not grounded');
    if (!body.sources?.some((source) => source.fileId === fileId)) reasons.push('uploaded file is missing from answer sources');
  } else if (step === 'cleanup' || step === 'cleanup-repeat') {
    if (body.id !== fileId) reasons.push('cleanup file id does not match upload');
    if (body.status !== 'archived') reasons.push(`cleanup status is ${body.status ?? 'missing'}`);
    if (body._count?.chunks !== 0) reasons.push('chunks remain after cleanup');
    if (body.metadata?.deletedObject !== true) reasons.push('S3 object deletion is not confirmed');
    if (body.metadata?.deleteObjectRequested !== true) reasons.push('S3 object deletion request is not recorded');
    if (body.metadata?.objectCleanupStatus !== 'completed') reasons.push('S3 cleanup status is not completed');
    if (context.archivedAt && body.metadata?.archivedAt !== context.archivedAt) {
      reasons.push('archivedAt changed during duplicate cleanup');
    }
  } else {
    reasons.push(`unknown lifecycle step: ${step}`);
  }

  return reasons;
}

export function evaluateKnowledgeUploadRejection(result, expectation) {
  const reasons = [];
  const body = result?.body;

  if (result?.status !== expectation.status) reasons.push(`status ${result?.status ?? 'missing'}, expected ${expectation.status}`);
  if (!body || typeof body !== 'object') return [...reasons, 'response body is not an object'];
  if (body.statusCode !== expectation.status) reasons.push(`body statusCode ${body.statusCode ?? 'missing'}, expected ${expectation.status}`);
  if (body.code !== expectation.code) reasons.push(`error code ${body.code ?? 'missing'}, expected ${expectation.code}`);
  if (!body.requestId) reasons.push('body requestId is missing');
  if (!result.correlationId) reasons.push('x-correlation-id is missing');
  if (body.requestId && result.correlationId && body.requestId !== result.correlationId) reasons.push('body requestId does not match x-correlation-id');
  if (expectation.messageIncludes && !JSON.stringify(body.message).includes(expectation.messageIncludes)) reasons.push(`message does not include ${expectation.messageIncludes}`);

  return reasons;
}
