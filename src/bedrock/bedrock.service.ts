import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

import { PrismaService } from '../prisma/prisma.service';
import { ConverseDto } from './dto/converse.dto';
import { TextResponseDto } from './dto/text-response.dto';

@Injectable()
export class BedrockService {
  private readonly bedrockClient: BedrockClient;
  private readonly client: BedrockRuntimeClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.unsetBlankAwsOptionalEnvVars();

    const region = this.configService.get<string>('AWS_REGION') ?? 'us-east-1';

    this.bedrockClient = new BedrockClient({ region });
    this.client = new BedrockRuntimeClient({
      region,
    });
  }

  getConfig() {
    return {
      region: this.configService.get<string>('AWS_REGION') ?? 'us-east-1',
      defaultModelId:
        this.configService.get<string>('BEDROCK_MODEL_ID') || null,
      hasAccessKeyId: Boolean(
        this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      ),
      hasSecretAccessKey: Boolean(
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      ),
      hasSessionToken: Boolean(
        this.configService.get<string>('AWS_SESSION_TOKEN'),
      ),
      hasBearerToken: Boolean(
        this.configService.get<string>('AWS_BEARER_TOKEN_BEDROCK'),
      ),
    };
  }

  async listFoundationModels() {
    const result = await this.bedrockClient.send(
      new ListFoundationModelsCommand({}),
    );

    return {
      region: this.configService.get<string>('AWS_REGION') ?? 'us-east-1',
      count: result.modelSummaries?.length ?? 0,
      models:
        result.modelSummaries?.map((model) => ({
          modelId: model.modelId,
          modelName: model.modelName,
          providerName: model.providerName,
          inputModalities: model.inputModalities,
          outputModalities: model.outputModalities,
          inferenceTypesSupported: model.inferenceTypesSupported,
          responseStreamingSupported: model.responseStreamingSupported,
        })) ?? [],
    };
  }

  async converse(dto: ConverseDto, appcode: string) {
    const modelId =
      dto.modelId ?? this.configService.get<string>('BEDROCK_MODEL_ID');

    if (!modelId) {
      throw new BadRequestException(
        'modelId 또는 BEDROCK_MODEL_ID 환경변수를 설정해야 합니다.',
      );
    }

    const searchAt = new Date();
    const startedAt = Date.now();

    try {
      const result = await this.client.send(
        new ConverseCommand({
          modelId,
          messages: [
            {
              role: 'user',
              content: [{ text: dto.message }],
            },
          ],
          system: dto.system ? [{ text: dto.system }] : undefined,
          inferenceConfig: {
            maxTokens: dto.maxTokens ?? 1024,
            temperature: dto.temperature ?? 0.7,
          },
        }),
      );

      const latencyMs = Date.now() - startedAt;
      const text = this.extractText(result);
      const usage = result.usage;

      await this.createSearchLog({
        appcode,
        searchword: dto.message,
        searchat: searchAt,
        responsetime: latencyMs,
        inputtokens: usage?.inputTokens,
        outputtokens: usage?.outputTokens,
        totaltokens: usage?.totalTokens,
      });

      return {
        modelId,
        response: text,
        usage,
        latencyMs,
      };
    } catch (error) {
      throw error;
    }
  }

  async createTextResponse(dto: TextResponseDto, appcode: string) {
    const result = await this.converse({ message: dto.message }, appcode);

    return {
      response: result.response,
    };
  }

  private extractText(result: ConverseCommandOutput) {
    const content = result.output?.message?.content ?? [];
    const text = content
      .map((item) => item.text)
      .filter((item): item is string => Boolean(item))
      .join('\n');

    return text || JSON.stringify(result.output ?? {});
  }

  private createSearchLog(data: {
    appcode: string;
    searchword: string;
    searchat: Date;
    responsetime: number;
    inputtokens?: number;
    outputtokens?: number;
    totaltokens?: number;
  }) {
    return this.prisma.bedrockSearchLog.create({
      data,
    });
  }

  private unsetBlankAwsOptionalEnvVars() {
    ['AWS_PROFILE', 'AWS_SESSION_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK'].forEach(
      (key) => {
        if (process.env[key] === '') {
          delete process.env[key];
        }
      },
    );
  }
}
