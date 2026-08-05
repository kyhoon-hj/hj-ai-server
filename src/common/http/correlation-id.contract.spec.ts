import { BadRequestException, HttpStatus } from '@nestjs/common';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { StructuredHttpExceptionFilter } from './structured-http-exception.filter';

describe('TS-CON-006 correlation and structured error contract', () => {
  const requestId = '6ca66f47-9b2e-4c78-919e-e65cbe5ad939';

  it('echoes a valid caller correlation ID', () => {
    const middleware = new CorrelationIdMiddleware();
    const request = {
      header: jest.fn().mockReturnValue(requestId),
    };
    const response = { setHeader: jest.fn() };
    const next = jest.fn();

    middleware.use(request as never, response as never, next);

    expect(request).toHaveProperty('correlationId', requestId);
    expect(response.setHeader).toHaveBeenLastCalledWith(
      'x-correlation-id',
      requestId,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed correlation IDs', () => {
    const middleware = new CorrelationIdMiddleware();

    expect(() =>
      middleware.use(
        { header: jest.fn().mockReturnValue('not-a-uuid') } as never,
        { setHeader: jest.fn() } as never,
        jest.fn(),
      ),
    ).toThrow(BadRequestException);
  });

  it('preserves Nest error fields and adds code and requestId', () => {
    const filter = new StructuredHttpExceptionFilter();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { setHeader: jest.fn(), status, json };
    const request = { correlationId: requestId };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };

    filter.catch(
      new BadRequestException(['query should not be empty']),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['query should not be empty'],
      error: 'Bad Request',
      code: 'VALIDATION_ERROR',
      requestId,
    });
  });
});
