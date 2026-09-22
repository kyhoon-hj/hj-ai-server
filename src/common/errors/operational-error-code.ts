import { HttpException, HttpStatus } from '@nestjs/common';

type ErrorRecord = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
};

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;

export function operationalErrorCode(error: unknown): string {
  const record =
    typeof error === 'object' && error !== null
      ? (error as ErrorRecord)
      : ({} as ErrorRecord);
  const explicitCode =
    typeof record.code === 'string' && SAFE_CODE.test(record.code)
      ? record.code
      : undefined;
  if (explicitCode) return explicitCode;

  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string' && SAFE_CODE.test(message))
        return message;
    }
    if (typeof response === 'string' && SAFE_CODE.test(response))
      return response;
  }

  const name = typeof record.name === 'string' ? record.name : '';
  const message =
    typeof record.message === 'string' ? record.message.toLowerCase() : '';
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : typeof record.$metadata?.httpStatusCode === 'number'
        ? record.$metadata.httpStatusCode
        : undefined;

  if (name.includes('Throttling') || status === HttpStatus.TOO_MANY_REQUESTS) {
    return 'UPSTREAM_THROTTLED';
  }
  if (
    name.includes('Timeout') ||
    name === 'AbortError' ||
    /\b(?:timeout|timed out|econnreset|etimedout)\b/.test(message)
  ) {
    return 'UPSTREAM_TIMEOUT';
  }
  if (name.includes('AccessDenied') || status === HttpStatus.FORBIDDEN) {
    return 'UPSTREAM_ACCESS_DENIED';
  }
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status !== undefined && status >= 500) {
    return 'UPSTREAM_TEMPORARILY_UNAVAILABLE';
  }
  return 'REQUEST_FAILED';
}
