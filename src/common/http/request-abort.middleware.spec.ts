import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import {
  type AbortableRequest,
  RequestAbortMiddleware,
} from './request-abort.middleware';

describe('RequestAbortMiddleware', () => {
  function fixture() {
    const request = new EventEmitter() as AbortableRequest;
    const response = new EventEmitter() as Response;
    Object.defineProperty(response, 'writableFinished', {
      value: false,
      writable: true,
    });
    const next = jest.fn() as NextFunction;
    new RequestAbortMiddleware().use(request, response, next);
    return { request, response, next };
  }

  it('aborts downstream work when the client disconnects early', () => {
    const { request, response, next } = fixture();
    response.emit('close');

    expect(next).toHaveBeenCalledTimes(1);
    expect(request.abortSignal?.aborted).toBe(true);
  });

  it('does not abort after a response finishes normally', () => {
    const { request, response } = fixture();
    Object.defineProperty(response, 'writableFinished', { value: true });
    response.emit('finish');
    response.emit('close');

    expect(request.abortSignal?.aborted).toBe(false);
  });
});
