import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { operationalErrorCode } from './operational-error-code';

describe('operationalErrorCode', () => {
  it.each([
    [
      Object.assign(new Error(), { name: 'ThrottlingException' }),
      'UPSTREAM_THROTTLED',
    ],
    [
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      'UPSTREAM_TIMEOUT',
    ],
    [
      Object.assign(new Error(), { name: 'AccessDeniedException' }),
      'UPSTREAM_ACCESS_DENIED',
    ],
    [new BadRequestException(), 'VALIDATION_ERROR'],
    [new ForbiddenException(), 'UPSTREAM_ACCESS_DENIED'],
    [new HttpException('failure', 503), 'UPSTREAM_TEMPORARILY_UNAVAILABLE'],
    [new Error('unknown'), 'REQUEST_FAILED'],
  ])('classifies an operational failure', (error, expected) => {
    expect(operationalErrorCode(error)).toBe(expected);
  });

  it('preserves an explicit safe code but rejects arbitrary values', () => {
    expect(operationalErrorCode({ code: 'MODEL_NOT_READY' })).toBe(
      'MODEL_NOT_READY',
    );
    expect(operationalErrorCode({ code: 'secret detail' })).toBe(
      'REQUEST_FAILED',
    );
  });
});
