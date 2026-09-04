import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createServer, Server, ServerResponse } from 'node:http';
import {
  createServer as createHttp2Server,
  Http2Server,
  Http2ServerResponse,
  ServerHttp2Session,
} from 'node:http2';
import { AddressInfo } from 'node:net';
import { classifyKnowledgeIndexJobError } from '../../knowledge/knowledge-index-job-error';
import { activeAwsRequestCount, runAwsRequest } from './aws-request-control';

// Real SDK transport against loopback only; never uses AWS credentials or endpoints.
describe('AWS HTTP transport fault contract', () => {
  let server: Server;
  let http2Server: Http2Server;
  let sessions: Set<ServerHttp2Session>;
  let endpoint: string;
  let requests: number;
  let respond: (response: ServerResponse | Http2ServerResponse) => void;
  let bedrock: BedrockRuntimeClient;
  let s3: S3Client;
  const command = () =>
    new ConverseCommand({
      modelId: 'local-test-model',
      messages: [{ role: 'user', content: [{ text: 'transport test' }] }],
      inferenceConfig: { maxTokens: 1 },
    });

  beforeEach(async () => {
    requests = 0;
    sessions = new Set();
    http2Server = createHttp2Server((request, response) => {
      request.resume();
      requests += 1;
      respond(response);
    });
    http2Server.on('session', (session) => {
      sessions.add(session);
      session.once('close', () => sessions.delete(session));
    });
    await new Promise<void>((resolve) =>
      http2Server.listen(0, '127.0.0.1', resolve),
    );
    server = createServer((request, response) => {
      request.resume();
      requests += 1;
      respond(response);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = {
      endpoint,
      region: 'us-west-2',
      credentials: {
        accessKeyId: 'LOCAL_TEST_ONLY',
        secretAccessKey: 'LOCAL_TEST_ONLY',
      },
      maxAttempts: 3,
      retryMode: 'adaptive' as const,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 5000 },
    };
    bedrock = new BedrockRuntimeClient({
      ...config,
      endpoint: `http://127.0.0.1:${(http2Server.address() as AddressInfo).port}`,
    });
    s3 = new S3Client({ ...config, forcePathStyle: true });
  });

  afterEach(async () => {
    bedrock.destroy();
    s3.destroy();
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve, reject) =>
      http2Server.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    expect(activeAwsRequestCount()).toBe(0);
  });

  function failure(
    response: ServerResponse | Http2ServerResponse,
    status: number,
    name: string,
  ) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.setHeader('x-amzn-errortype', name);
    response.end(JSON.stringify({ message: 'Synthetic transport failure' }));
  }

  it.each([
    [429, 'ThrottlingException'],
    [500, 'InternalServerException'],
    [503, 'ServiceUnavailableException'],
  ])(
    'retries HTTP %s and recovers on the second request',
    async (status, name) => {
      respond = (response) => {
        if (requests === 1) return failure(response, status, name);
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            metrics: { latencyMs: 1 },
          }),
        );
      };
      const result = await runAwsRequest(
        (abortSignal) => bedrock.send(command(), { abortSignal }),
        { timeoutMs: 15000 },
      );
      expect(result.$metadata.attempts).toBe(2);
      expect(requests).toBe(2);
    },
    20000,
  );

  it('exhausts 503 retries and preserves the job retry classification', async () => {
    respond = (response) =>
      failure(response, 503, 'ServiceUnavailableException');
    const error: unknown = await runAwsRequest(
      (abortSignal) => bedrock.send(command(), { abortSignal }),
      { timeoutMs: 15000 },
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({
      name: 'ServiceUnavailableException',
      $metadata: { httpStatusCode: 503, attempts: 3 },
    });
    expect(requests).toBe(3);
    expect(classifyKnowledgeIndexJobError(error, 1, 1000)).toMatchObject({
      errorCode: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
      retryable: true,
    });
  }, 20000);

  it.each([
    [400, 'ValidationException', 'INVALID_INDEX_REQUEST'],
    [403, 'AccessDeniedException', 'UPSTREAM_ACCESS_DENIED'],
  ])('does not retry HTTP %s', async (status, name, errorCode) => {
    respond = (response) => failure(response, status, name);
    const error: unknown = await bedrock
      .send(command())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      name,
      $metadata: { httpStatusCode: status, attempts: 1 },
    });
    expect(requests).toBe(1);
    expect(classifyKnowledgeIndexJobError(error, 1, 1000)).toMatchObject({
      errorCode,
      retryable: false,
    });
  });

  it('deserializes S3 NoSuchKey as a permanent source failure', async () => {
    respond = (response) => {
      response.statusCode = 404;
      response.setHeader('content-type', 'application/xml');
      response.end(
        '<Error><Code>NoSuchKey</Code><Message>Synthetic missing key</Message></Error>',
      );
    };
    const error: unknown = await s3
      .send(new GetObjectCommand({ Bucket: 'local-test', Key: 'missing' }))
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404, attempts: 1 },
    });
    expect(classifyKnowledgeIndexJobError(error, 1, 1000)).toMatchObject({
      errorCode: 'INDEX_SOURCE_NOT_FOUND',
      retryable: false,
    });
    expect(requests).toBe(1);
  });

  it('aborts an unresponsive HTTP request at the application deadline', async () => {
    respond = () => undefined;
    const error: unknown = await runAwsRequest(
      (abortSignal) => bedrock.send(command(), { abortSignal }),
      { timeoutMs: 200 },
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: 'GatewayTimeoutException' });
    expect(classifyKnowledgeIndexJobError(error, 1, 1000)).toMatchObject({
      errorCode: 'UPSTREAM_TIMEOUT',
      retryable: true,
    });
    expect(requests).toBe(1);
  });

  it('propagates caller cancellation to an in-flight SDK request', async () => {
    const parent = new AbortController();
    respond = () => parent.abort();
    await expect(
      runAwsRequest((abortSignal) => bedrock.send(command(), { abortSignal }), {
        timeoutMs: 5000,
        parentSignal: parent.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toBe(1);
  });
});
