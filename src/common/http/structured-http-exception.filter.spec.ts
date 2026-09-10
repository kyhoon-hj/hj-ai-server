import type { ArgumentsHost } from '@nestjs/common';
import { StructuredHttpExceptionFilter } from './structured-http-exception.filter';

it('exposes only sanitized SDK counters on a failed HTTP response', () => {
  const json = jest.fn<void, [{ sdk: unknown; message: string }]>();
  const response = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ json }),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ correlationId: 'fixture' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new StructuredHttpExceptionFilter().catch(
    Object.assign(new Error('private'), {
      $metadata: { attempts: 3, totalRetryDelay: 120, requestId: 'private' },
    }),
    host,
  );
  expect(json.mock.calls[0][0].sdk).toEqual({
    scope: 'failed-call',
    attempts: 3,
    retryCount: 2,
    totalRetryDelayMs: 120,
  });
  expect(json.mock.calls[0][0].message).toBe('Internal server error');
});
