import {
  GatewayTimeoutException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readAwsAttempts } from './aws-attempts';
import { awsMetricsContext } from './aws-request-metrics';

const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const activeControllers = new Set<AbortController>();

type AwsRequestOptions = {
  timeoutMs: number;
  parentSignal?: AbortSignal;
};

function abortError(message: string) {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function getAwsConnectionTimeoutMs(configService: ConfigService) {
  return boundedInteger(
    configService.get<string>('AWS_CONNECTION_TIMEOUT_MS'),
    DEFAULT_CONNECTION_TIMEOUT_MS,
    100,
    60_000,
  );
}

export function getAwsRequestTimeoutMs(configService: ConfigService) {
  return boundedInteger(
    configService.get<string>('AWS_REQUEST_TIMEOUT_MS'),
    DEFAULT_REQUEST_TIMEOUT_MS,
    100,
    300_000,
  );
}

export function getAwsRequestHandlerOptions(configService: ConfigService) {
  return {
    connectionTimeout: getAwsConnectionTimeoutMs(configService),
    requestTimeout: getAwsRequestTimeoutMs(configService),
  };
}

export async function runAwsRequest<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  options: AwsRequestOptions,
) {
  if (options.parentSignal?.aborted) {
    throw abortError('Caller aborted the AWS request.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () =>
    controller.abort(abortError('Caller aborted the AWS request.'));
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(abortError('AWS request timed out.'));
  }, options.timeoutMs);
  timeout.unref();
  options.parentSignal?.addEventListener('abort', abortFromParent, {
    once: true,
  });
  activeControllers.add(controller);
  const metrics = awsMetricsContext.getStore();
  if (metrics && !metrics.closed) metrics.started++;

  try {
    const result = await operation(controller.signal);
    if (metrics && !metrics.closed)
      metrics.completed.push(readAwsAttempts(result));
    return result;
  } catch (error) {
    if (metrics && !metrics.closed)
      metrics.completed.push(readAwsAttempts(error));
    const record =
      error && typeof error === 'object' ? (error as { name?: unknown }) : {};
    const name = typeof record.name === 'string' ? record.name : '';
    if (timedOut || name.includes('Timeout')) {
      const metadata = readAwsAttempts(error);
      throw Object.assign(
        new GatewayTimeoutException({
          message: 'AWS dependency request timed out.',
          code: 'AWS_REQUEST_TIMEOUT',
        }),
        {
          $metadata: {
            attempts: metadata.attempts,
            totalRetryDelay: metadata.totalRetryDelayMs,
          },
        },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.parentSignal?.removeEventListener('abort', abortFromParent);
    activeControllers.delete(controller);
  }
}

export function abortAllAwsRequests() {
  for (const controller of activeControllers) {
    controller.abort(abortError('Application is shutting down.'));
  }
}

export function activeAwsRequestCount() {
  return activeControllers.size;
}

@Injectable()
export class AwsRequestShutdownService implements OnModuleDestroy {
  onModuleDestroy() {
    abortAllAwsRequests();
  }
}
