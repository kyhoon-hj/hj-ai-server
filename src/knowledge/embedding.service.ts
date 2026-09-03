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
      maxAttempts: 5,
      retryMode: 'adaptive',
    });
  }

  getDefaultEmbeddingModelId() {
    return (
      this.configService.get<string>('BEDROCK_EMBEDDING_MODEL_ID') ??
      'amazon.titan-embed-text-v2:0'
    );
  }

  async createEmbedding(
    text: string,
    modelId = this.getDefaultEmbeddingModelId(),
  ) {
    return this.invokeEmbedding(text, modelId);
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
}
