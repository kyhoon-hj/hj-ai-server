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
});
