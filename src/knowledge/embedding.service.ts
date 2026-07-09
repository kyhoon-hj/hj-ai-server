import { setTimeout as delay } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

type EmbeddingResponse = {
  embedding?: number[];
  inputTextTokenCount?: number;
};

@Injectable()
export class EmbeddingService {
  private readonly bedrockClient: BedrockRuntimeClient;

  constructor(private readonly configService: ConfigService) {
    this.bedrockClient = new BedrockRuntimeClient({
      region: this.configService.get<string>('AWS_REGION') ?? 'us-east-1',
    });
  }

  getDefaultEmbeddingModelId() {
    return (
      this.configService.get<string>('BEDROCK_EMBEDDING_MODEL_ID') ??
      'amazon.titan-embed-text-v2:0'
    );
  }

  async createEmbedding(text: string, modelId = this.getDefaultEmbeddingModelId()) {
    const maxAttempts =
      this.configService.get<number>('BEDROCK_EMBEDDING_MAX_ATTEMPTS') ?? 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.invokeEmbedding(text, modelId);
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          break;
        }

        await delay(this.getRetryDelayMs(attempt));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Bedrock embedding 생성에 실패했습니다.');
  }

  private async invokeEmbedding(text: string, modelId: string) {
    const response = await this.bedrockClient.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
          dimensions: 1024,
          normalize: true,
        }),
      }),
    );
    const decoded = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(decoded) as EmbeddingResponse;

    if (!parsed.embedding?.length) {
      throw new Error('Bedrock embedding 응답에 embedding이 없습니다.');
    }

    return parsed.embedding;
  }

  private getRetryDelayMs(attempt: number) {
    const baseDelayMs =
      this.configService.get<number>('BEDROCK_EMBEDDING_RETRY_DELAY_MS') ?? 500;

    return baseDelayMs * 2 ** (attempt - 1);
  }
}
