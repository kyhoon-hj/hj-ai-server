import type { ExecutionContext } from '@nestjs/common';
import { from, lastValueFrom } from 'rxjs';
import { AwsMetricsInterceptor } from './aws-metrics.interceptor';
import { runAwsRequest } from '../aws/aws-request-control';
import {
  summarizeAwsMetrics,
  type AwsMetrics,
} from '../aws/aws-request-metrics';

const call = (attempts?: number) =>
  runAwsRequest(
    () =>
      Promise.resolve({
        $metadata: {
          attempts,
          totalRetryDelay: attempts === undefined ? undefined : 10,
        },
      }),
    { timeoutMs: 1000 },
  );
function execute(operation: () => Promise<object>) {
  const request: { awsMetrics?: AwsMetrics } = {};
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const result = lastValueFrom(
    new AwsMetricsInterceptor().intercept(context, {
      handle: () => from(operation()),
    }),
  );
  return { request, result };
}

describe('request AWS metrics', () => {
  it('isolates overlapping requests and sums retrieval and generation calls', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = execute(async () => {
      await call(2);
      await gate;
      await call(3);
      return {};
    });
    const second = execute(async () => {
      await call(1);
      release();
      return {};
    });
    expect(await first.result).toMatchObject({
      awsRequest: { operations: 2, attempts: 5, retryCount: 3, complete: true },
    });
    expect(await second.result).toMatchObject({
      awsRequest: { operations: 1, attempts: 1, retryCount: 0 },
    });
    expect(first.request.awsMetrics?.closed).toBe(true);
  });
  it('does not treat partial measurement as a complete total', async () => {
    const task = execute(async () => {
      await call(2);
      await call();
      return {};
    });
    expect(await task.result).toMatchObject({
      awsRequest: {
        operations: 2,
        measuredOperations: 1,
        attempts: null,
        complete: false,
      },
    });
  });
  it('keeps earlier successes and the failed call for error responses', async () => {
    const failure = Object.assign(new Error('fixture'), {
      $metadata: { attempts: 3, totalRetryDelay: 20 },
    });
    const task = execute(async () => {
      await call(2);
      await runAwsRequest(() => Promise.reject(failure), { timeoutMs: 1000 });
      return {};
    });
    await expect(task.result).rejects.toBe(failure);
    expect(summarizeAwsMetrics(task.request.awsMetrics!)).toMatchObject({
      operations: 2,
      attempts: 5,
      retryCount: 3,
      totalRetryDelayMs: 30,
    });
  });
  it('records zero when a request makes no wrapped AWS calls', async () => {
    expect(await execute(() => Promise.resolve({})).result).toMatchObject({
      awsRequest: { operations: 0, attempts: 0, complete: true },
    });
  });
});
