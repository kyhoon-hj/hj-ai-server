import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export type CorrelatedRequest = Request & {
  correlationId?: string;
};

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: CorrelatedRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const supplied = request.header(CORRELATION_ID_HEADER);
    const correlationId = randomUUID();

    request.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    if (supplied) {
      if (!this.isUuid(supplied)) {
        throw new BadRequestException(
          `${CORRELATION_ID_HEADER} must be a UUID`,
        );
      }

      request.correlationId = supplied;
      response.setHeader(CORRELATION_ID_HEADER, supplied);
    }

    next();
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
