import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  type CorrelatedRequest,
} from './correlation-id.middleware';

@Catch()
export class StructuredHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<CorrelatedRequest>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? exceptionResponse
        : {};
    const requestId = request.correlationId ?? randomUUID();
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : 'message' in body
          ? body.message
          : status === 500
            ? 'Internal server error'
            : HttpStatus[status];
    const error =
      'error' in body && typeof body.error === 'string'
        ? body.error
        : HttpStatus[status];
    const code =
      'code' in body && typeof body.code === 'string'
        ? body.code
        : this.toErrorCode(status);

    response.setHeader(CORRELATION_ID_HEADER, requestId);
    response.status(status).json({
      statusCode: status,
      message,
      error,
      code,
      requestId,
    });
  }

  private toErrorCode(status: number) {
    const knownCodes: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
      [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION_REQUIRED',
      [HttpStatus.FORBIDDEN]: 'ACCESS_DENIED',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'INVALID_STATE',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    };

    return knownCodes[status] ?? 'INTERNAL_ERROR';
  }
}
