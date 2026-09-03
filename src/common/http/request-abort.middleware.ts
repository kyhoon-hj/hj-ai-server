import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export type AbortableRequest = Request & {
  abortSignal?: AbortSignal;
};

@Injectable()
export class RequestAbortMiddleware implements NestMiddleware {
  use(request: AbortableRequest, response: Response, next: NextFunction) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortIfDisconnected = () => {
      if (!response.writableFinished) abort();
    };
    const cleanup = () => {
      request.removeListener('aborted', abort);
      response.removeListener('close', abortIfDisconnected);
    };

    request.abortSignal = controller.signal;
    request.once('aborted', abort);
    response.once('close', abortIfDisconnected);
    response.once('finish', cleanup);
    next();
  }
}
