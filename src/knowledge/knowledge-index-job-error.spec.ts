import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { classifyKnowledgeIndexJobError } from './knowledge-index-job-error';

function awsError(
  name: string,
  status: number,
  headers?: Record<string, string>,
) {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: status },
    $response: { headers },
  });
}

describe('classifyKnowledgeIndexJobError', () => {
  it.each([
    ['ThrottlingException', 429, 'UPSTREAM_THROTTLED'],
    ['ModelTimeoutException', 408, 'UPSTREAM_TIMEOUT'],
    ['ServiceUnavailableException', 503, 'UPSTREAM_TEMPORARILY_UNAVAILABLE'],
    ['InternalServerException', 500, 'UPSTREAM_TEMPORARILY_UNAVAILABLE'],
  ])('classifies %s as retryable', (name, status, errorCode) => {
    expect(
      classifyKnowledgeIndexJobError(awsError(name, status), 2, 1_000),
    ).toMatchObject({ retryable: true, errorCode, retryAfterMs: 2_000 });
  });

  it('honors a bounded Retry-After response header', () => {
    expect(
      classifyKnowledgeIndexJobError(
        awsError('ThrottlingException', 429, { 'retry-after': '12' }),
        1,
        1_000,
      ),
    ).toMatchObject({ retryable: true, retryAfterMs: 12_000 });
  });

  it.each([
    [new BadRequestException(), 'INVALID_INDEX_REQUEST'],
    [new ForbiddenException(), 'UPSTREAM_ACCESS_DENIED'],
    [new NotFoundException(), 'INDEX_SOURCE_NOT_FOUND'],
    [awsError('ValidationException', 400), 'INVALID_INDEX_REQUEST'],
    [awsError('AccessDeniedException', 403), 'UPSTREAM_ACCESS_DENIED'],
    [awsError('NoSuchKey', 404), 'INDEX_SOURCE_NOT_FOUND'],
  ])('does not retry permanent errors', (error, errorCode) => {
    expect(classifyKnowledgeIndexJobError(error, 1, 1_000)).toMatchObject({
      retryable: false,
      errorCode,
      retryAfterMs: 0,
    });
  });

  it('classifies temporary Prisma connectivity failures as retryable', () => {
    const error = Object.assign(new Error('database unavailable'), {
      code: 'P1001',
    });
    expect(classifyKnowledgeIndexJobError(error, 1, 500)).toMatchObject({
      retryable: true,
      errorCode: 'DATABASE_TEMPORARILY_UNAVAILABLE',
      retryAfterMs: 500,
    });
  });

  it('does not persist an unknown internal error message', () => {
    const failure = classifyKnowledgeIndexJobError(
      new Error('secret object key and credential'),
      1,
      500,
    );
    expect(failure).toMatchObject({
      retryable: false,
      errorCode: 'INDEXING_ERROR',
    });
    expect(failure.errorMessage).not.toContain('secret');
  });

  it.each([
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ERR_HTTP2_GOAWAY_SESSION',
    'ERR_HTTP2_STREAM_CANCEL',
    'ERR_HTTP2_INVALID_SESSION',
  ])(
    'retries native transport code %s without depending on message wording',
    (code) => {
      const error = Object.assign(new Error('arbitrary private diagnostic'), {
        code,
      });
      expect(classifyKnowledgeIndexJobError(error, 2, 100)).toMatchObject({
        retryable: true,
        errorCode: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
        retryAfterMs: 200,
      });
      expect(
        classifyKnowledgeIndexJobError(error, 2, 100).errorMessage,
      ).not.toContain('private');
    },
  );
  it('recognizes the real HTTP2 no-response error and wrapped socket resets', () => {
    for (const error of [
      new Error('Unexpected error: http2 request did not get a response'),
      new Error('SDK wrapper', {
        cause: Object.assign(new Error('aborted'), { code: 'ECONNRESET' }),
      }),
    ])
      expect(classifyKnowledgeIndexJobError(error, 1, 100).retryable).toBe(
        true,
      );
  });
  it('keeps protocol/configuration errors and permanent responses non-retryable', () => {
    for (const error of [
      Object.assign(new Error('protocol mismatch'), {
        code: 'ERR_HTTP2_ERROR',
      }),
      Object.assign(new Error('invalid host'), { code: 'ENOTFOUND' }),
      {
        ...awsError('AccessDeniedException', 403),
        cause: { code: 'ECONNRESET' },
      },
    ])
      expect(classifyKnowledgeIndexJobError(error, 1, 100).retryable).toBe(
        false,
      );
  });
});
