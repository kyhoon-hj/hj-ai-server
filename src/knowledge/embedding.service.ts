import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  getAwsRequestHandlerOptions,
  getAwsRequestTimeoutMs,
  runAwsRequest,
} from '../common/aws/aws-request-control';

type EmbeddingResponse = {
  embedding?: number[];
  inputTextTokenCount?: number;
};

@Injectable()
export class EmbeddingService {
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly requestTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.requestTimeoutMs = getAwsRequestTimeoutMs(this.configService);
    this.bedrockClient = new BedrockRuntimeClient({
      region: this.configService.get<string>('AWS_REGION') ?? 'us-east-1',
      maxAttempts: 5,
      retryMode: 'adaptive',
      requestHandler: getAwsRequestHandlerOptions(this.configService),
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
    parentSignal?: AbortSignal,
  ) {
    return this.invokeEmbedding(text, modelId, parentSignal);
  }

  private async invokeEmbedding(
    text: string,
    modelId: string,
    parentSignal?: AbortSignal,
  ) {
    const response = await runAwsRequest(
      (abortSignal) =>
        this.bedrockClient.send(
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
          { abortSignal },
        ),
      { timeoutMs: this.requestTimeoutMs, parentSignal },
    );
    const decoded = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(decoded) as EmbeddingResponse;

    if (!parsed.embedding?.length) {
      throw new Error('Bedrock embedding 응답에 embedding이 없습니다.');
    }

    return parsed.embedding;
  }
}
