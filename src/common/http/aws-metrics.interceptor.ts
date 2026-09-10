import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize, map } from 'rxjs';
import {
  awsMetricsContext,
  createAwsMetrics,
  summarizeAwsMetrics,
  type AwsMetrics,
} from '../aws/aws-request-metrics';

@Injectable()
export class AwsMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = createAwsMetrics();
    context
      .switchToHttp()
      .getRequest<{ awsMetrics?: AwsMetrics }>().awsMetrics = store;
    return new Observable<unknown>((subscriber) =>
      awsMetricsContext.run(store, () => next.handle().subscribe(subscriber)),
    ).pipe(
      map((body: unknown) =>
        body &&
        typeof body === 'object' &&
        Object.getPrototypeOf(body) === Object.prototype
          ? { ...body, awsRequest: summarizeAwsMetrics(store) }
          : body,
      ),
      finalize(() => {
        store.closed = true;
      }),
    );
  }
}
