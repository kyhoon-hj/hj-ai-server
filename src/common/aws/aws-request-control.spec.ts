import {
  abortAllAwsRequests,
  activeAwsRequestCount,
  runAwsRequest,
} from './aws-request-control';

function pendingUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      { once: true },
    );
  });
}

describe('AWS request control', () => {
  afterEach(() => {
    abortAllAwsRequests();
    jest.useRealTimers();
  });

  it('aborts an AWS operation when its request timeout expires', async () => {
    jest.useFakeTimers();
    const request = runAwsRequest(pendingUntilAborted, { timeoutMs: 100 });
    const rejection = expect(request).rejects.toMatchObject({
      status: 504,
      response: {
        code: 'AWS_REQUEST_TIMEOUT',
      },
    });

    expect(activeAwsRequestCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(100);
    await rejection;
    expect(activeAwsRequestCount()).toBe(0);
  });

  it('propagates a caller abort and removes the active request', async () => {
    const parent = new AbortController();
    const request = runAwsRequest(pendingUntilAborted, {
      timeoutMs: 30_000,
      parentSignal: parent.signal,
    });

    parent.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(activeAwsRequestCount()).toBe(0);
  });

  it('aborts all active AWS operations during shutdown', async () => {
    const first = runAwsRequest(pendingUntilAborted, { timeoutMs: 30_000 });
    const second = runAwsRequest(pendingUntilAborted, { timeoutMs: 30_000 });

    expect(activeAwsRequestCount()).toBe(2);
    abortAllAwsRequests();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(activeAwsRequestCount()).toBe(0);
  });
});
