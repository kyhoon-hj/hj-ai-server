import { AsyncLocalStorage } from 'node:async_hooks';
import { readAwsAttempts } from './aws-attempts';

type Measurement = ReturnType<typeof readAwsAttempts>;
export type AwsMetrics = {
  started: number;
  completed: Measurement[];
  closed: boolean;
};
export const awsMetricsContext = new AsyncLocalStorage<AwsMetrics>();
export function createAwsMetrics(): AwsMetrics {
  return { started: 0, completed: [], closed: false };
}
export function summarizeAwsMetrics(store: AwsMetrics) {
  const records = store.completed;
  const measured = records.filter((r) => r.attempts !== null);
  const complete =
    records.length === store.started && measured.length === store.started;
  const delays = records.filter((r) => r.totalRetryDelayMs !== null);
  return {
    scope: 'request-wrapped-aws-operations',
    operations: store.started,
    completedOperations: records.length,
    measuredOperations: measured.length,
    complete,
    attempts: complete
      ? measured.reduce((sum, r) => sum + r.attempts!, 0)
      : null,
    retryCount: complete
      ? measured.reduce((sum, r) => sum + r.retryCount!, 0)
      : null,
    totalRetryDelayMs:
      records.length === store.started && delays.length === store.started
        ? delays.reduce((sum, r) => sum + r.totalRetryDelayMs!, 0)
        : null,
  };
}
