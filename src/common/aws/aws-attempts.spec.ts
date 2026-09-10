import { readAwsAttempts } from './aws-attempts';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

describe('SDK attempt metadata', () => {
  it.each([false, true])(
    'observes actual SDK retry metadata (exhausted=%s)',
    async (exhausted) => {
      let calls = 0;
      const client = new BedrockRuntimeClient({
        region: 'us-east-1',
        maxAttempts: 2,
        credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' },
        requestHandler: {
          handle: () => {
            calls++;
            const fail = exhausted || calls === 1;
            return Promise.resolve({
              response: {
                statusCode: fail ? 429 : 200,
                headers: {
                  'content-type': 'application/json',
                  ...(fail
                    ? { 'x-amzn-errortype': 'ThrottlingException' }
                    : {}),
                },
                body: Buffer.from(
                  JSON.stringify(
                    fail
                      ? { message: 'synthetic throttle' }
                      : {
                          output: {
                            message: {
                              role: 'assistant',
                              content: [{ text: 'ok' }],
                            },
                          },
                        },
                  ),
                ),
              },
            });
          },
        },
      });
      try {
        const result: unknown = await client
          .send(
            new ConverseCommand({
              modelId: 'fixture',
              messages: [{ role: 'user', content: [{ text: 'test' }] }],
            }),
          )
          .catch((error: unknown) => error);
        expect(calls).toBe(2);
        expect(result instanceof Error).toBe(exhausted);
        expect(readAwsAttempts(result)).toMatchObject({
          attempts: 2,
          retryCount: 1,
        });
        expect(readAwsAttempts(result).totalRetryDelayMs).not.toBeNull();
      } finally {
        client.destroy();
      }
    },
  );
  it('reads success and error metadata without exposing other fields', () => {
    for (const value of [
      {
        $metadata: { attempts: 3, totalRetryDelay: 125, requestId: 'private' },
      },
      Object.assign(new Error('failure'), {
        $metadata: { attempts: 3, totalRetryDelay: 125 },
      }),
    ]) {
      expect(readAwsAttempts(value)).toEqual({
        attempts: 3,
        retryCount: 2,
        totalRetryDelayMs: 125,
      });
    }
  });
  it('keeps missing and malformed measurements unknown', () => {
    for (const value of [
      null,
      {},
      { $metadata: { attempts: 0, totalRetryDelay: -1 } },
      { $metadata: { attempts: 1.5, totalRetryDelay: Infinity } },
    ]) {
      expect(readAwsAttempts(value)).toEqual({
        attempts: null,
        retryCount: null,
        totalRetryDelayMs: null,
      });
    }
    expect(
      readAwsAttempts({ $metadata: { attempts: 1, totalRetryDelay: 0 } })
        .retryCount,
    ).toBe(0);
  });
});
