import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { runAwsRequest } from '../src/common/aws/aws-request-control';
import { classifyKnowledgeIndexJobError } from '../src/knowledge/knowledge-index-job-error';

// Explicit opt-in command only: no DB, object writes, IAM changes, or valid model calls.
async function main() {
  const region = process.env.AWS_REGION;
  const s3Region = process.env.AWS_S3_REGION ?? region;
  const bucket = process.env.AWS_S3_BUCKET;
  if (!region || !s3Region || !bucket) {
    throw new Error('AWS_REGION and AWS_S3_BUCKET are required.');
  }
  for (const value of [region, s3Region]) {
    if (!/^(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d+$/.test(value)) {
      throw new Error('This probe supports commercial AWS regions only.');
    }
  }
  const config = {
    maxAttempts: 5,
    retryMode: 'adaptive' as const,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
  };
  // Explicit endpoints prevent local endpoint overrides from producing false live passes.
  const s3 = new S3Client({
    ...config,
    region: s3Region,
    endpoint: `https://s3.${s3Region}.amazonaws.com`,
  });
  const bedrock = new BedrockRuntimeClient({
    ...config,
    region,
    endpoint: `https://bedrock-runtime.${region}.amazonaws.com`,
  });
  let passed = 0;
  async function probe(
    label: string,
    operation: (signal: AbortSignal) => Promise<void>,
    expectedName: string,
    expectedStatus: number,
    expectedCode: string,
  ) {
    let caught: unknown;
    try {
      await runAwsRequest(operation, { timeoutMs: 20000 });
    } catch (error) {
      caught = error;
    }
    const error = caught as
      | {
          name?: string;
          $metadata?: { httpStatusCode?: number; attempts?: number };
        }
      | undefined;
    const classification = classifyKnowledgeIndexJobError(caught, 1, 1000);
    const ok =
      error?.name === expectedName &&
      error.$metadata?.httpStatusCode === expectedStatus &&
      error.$metadata?.attempts === 1 &&
      classification.errorCode === expectedCode &&
      !classification.retryable;
    console.log(
      JSON.stringify({
        probe: label,
        result: ok ? 'PASS' : 'FAIL',
        name: error?.name ?? 'NoServiceError',
        status: error?.$metadata?.httpStatusCode,
        attempts: error?.$metadata?.attempts,
        errorCode: classification.errorCode,
        retryable: classification.retryable,
      }),
    );
    if (ok) passed += 1;
  }
  try {
    console.log(
      JSON.stringify({ mode: 'LIVE_AWS_FAILURES', region, s3Region }),
    );
    await probe(
      's3-missing-key',
      async (abortSignal) => {
        const result = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: `codex-failure-probe/${randomUUID()}/missing.txt`,
          }),
          { abortSignal },
        );
        // Unexpected success must also release the response stream without reading its content.
        if (result.Body instanceof Readable) result.Body.destroy();
      },
      'NoSuchKey',
      404,
      'INDEX_SOURCE_NOT_FOUND',
    );
    await probe(
      'bedrock-invalid-model',
      async (abortSignal) => {
        await bedrock.send(
          new ConverseCommand({
            modelId: `codex-nonexistent-model-${randomUUID()}`,
            messages: [
              { role: 'user', content: [{ text: 'Failure contract probe.' }] },
            ],
            inferenceConfig: { maxTokens: 1 },
          }),
          { abortSignal },
        );
      },
      'ValidationException',
      400,
      'INVALID_INDEX_REQUEST',
    );
    console.log(JSON.stringify({ passed, total: 2 }));
    if (passed !== 2) process.exitCode = 1;
  } finally {
    s3.destroy();
    bedrock.destroy();
  }
}

void main().catch(() => {
  // Never serialize SDK errors, signed headers, or credentials.
  console.error(
    'Live failure probe could not start; check local AWS configuration.',
  );
  process.exitCode = 1;
});
