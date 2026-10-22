import { config } from 'dotenv';
import { resolve } from 'node:path';
import { JevClient, JevError } from '../src/jev/jev-client';

config({ path: resolve(__dirname, '../.env'), quiet: true });

async function main() {
  const [command, balanceFlag, ...extra] = process.argv.slice(2);
  if (
    !['check', 'decision'].includes(command) ||
    extra.length ||
    (command === 'check' && balanceFlag) ||
    (command === 'decision' && balanceFlag !== '--use-balance')
  ) {
    throw new JevError(
      'Usage: npm run jev:check OR npm run jev:decision -- --use-balance',
    );
  }
  const client = new JevClient({
    apiKey: process.env.JEV_AI_API_KEY,
    baseURL: process.env.JEV_AI_BASE_URL,
    model: process.env.JEV_AI_MODEL,
    timeoutMs: Number(process.env.JEV_AI_TIMEOUT_MS || 3000),
  });
  console.log(
    JSON.stringify(
      {
        transport: 'native-fetch',
        automaticRetries: 0,
        ...client.destination,
        modelLookup: client.destination.baseURL + '/v1/models',
        decisionEndpoint: client.destination.baseURL + '/v1/systemone',
      },
      null,
      2,
    ),
  );
  const models = await client.listModels();
  const modelAvailable = models.some(
    ({ name }) => name === client.destination.model,
  );
  // Do not print provider-controlled descriptions or arbitrary response bodies.
  console.log(
    JSON.stringify({ modelLookup: 'ok', modelAvailable, inferenceCalls: 0 }),
  );
  if (!modelAvailable) throw new JevError('JEV_AI_MODEL_NOT_LISTED');
  if (command === 'check') return;
  const result = await client.decide(
    'I was charged twice for the same subscription.',
    {
      category: {
        type: 'choice',
        instructions: 'Which team should handle this support ticket?',
        criteria: { billing: null, technical: null, other: null },
      },
    },
  );
  console.log(JSON.stringify({ inferenceCalls: 1, ...result }, null, 2));
}

void main().catch((error: unknown) => {
  const failure =
    error instanceof JevError ? error : new JevError('JEV_AI_CHECK_FAILED');
  console.error(
    JSON.stringify({
      code: failure.code,
      status: failure.status,
      retryAfterMs: failure.retryAfterMs,
      outcome: failure.outcome,
    }),
  );
  process.exitCode = 1;
});
