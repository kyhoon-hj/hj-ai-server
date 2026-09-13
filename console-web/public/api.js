export class ConsoleApiError extends Error {
  constructor(status, code, message, correlationId) {
    super(message);
    this.name = 'ConsoleApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

async function parsePayload(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ConsoleApiError(
      response.status,
      'INVALID_RESPONSE',
      '서버 응답을 해석할 수 없습니다.',
      response.headers.get('x-correlation-id'),
    );
  }
}

export async function consoleRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await parsePayload(response);
  if (!response.ok) {
    const correlationId =
      response.headers.get('x-correlation-id') ??
      payload?.correlationId ??
      payload?.requestId ??
      null;
    throw new ConsoleApiError(
      response.status,
      payload?.code ?? `HTTP_${response.status}`,
      payload?.message ?? '요청을 처리하지 못했습니다.',
      correlationId,
    );
  }
  return payload;
}

export const appsApi = {
  list: () => consoleRequest('/console-api/v1/apps'),
  get: (id) => consoleRequest(`/console-api/v1/apps/${encodeURIComponent(id)}`),
  create: (input) =>
    consoleRequest('/console-api/v1/apps', { method: 'POST', body: input }),
  update: (id, input) =>
    consoleRequest(`/console-api/v1/apps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),
};

export const credentialsApi = {
  list: (appId) =>
    consoleRequest(
      `/console-api/v1/apps/${encodeURIComponent(appId)}/credentials`,
    ),
  issue: (appId, input) =>
    consoleRequest(
      `/console-api/v1/apps/${encodeURIComponent(appId)}/credentials`,
      { method: 'POST', body: input },
    ),
  rotate: (appId, input) =>
    consoleRequest(
      `/console-api/v1/apps/${encodeURIComponent(appId)}/credentials/rotate`,
      { method: 'POST', body: input },
    ),
  revoke: (appId, credentialId) =>
    consoleRequest(
      `/console-api/v1/apps/${encodeURIComponent(appId)}/credentials/${encodeURIComponent(credentialId)}`,
      { method: 'DELETE' },
    ),
};
