import { ConfigService } from '@nestjs/config';

import {
  BedrockService,
  GENERAL_ANSWER_PROMPT_VERSION,
} from './bedrock.service';

describe('BedrockService general answer contract', () => {
  function createService(response: string) {
    const logCreate = jest.fn().mockResolvedValue({});
    const service = new BedrockService(
      {
        get: jest.fn().mockReturnValue('model-v1'),
      } as unknown as ConfigService,
      { bedrockSearchLog: { create: logCreate } } as never,
    );
    const send = jest.fn().mockResolvedValue({
      output: { message: { content: [{ text: response }] } },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    Object.defineProperty(service, 'client', { value: { send } });
    return { service, send, logCreate };
  }

  it.each(['zinframe', 'ZINFRAME-test', 'ZINFRAME_P0', 'SUPPORT'])(
    'applies content retention policy at the database sink for %s',
    async (appcode) => {
      const { service, logCreate } = createService('private answer');
      await service.createGeneralAnswer(
        { query: 'private question' },
        { appcode, defaultModelId: 'model-v1' },
      );
      const [[{ data }]] = logCreate.mock.calls as [
        {
          data: { searchword: string; totaltokens: number };
        },
      ][];
      expect(data.searchword).toBe(
        appcode === 'SUPPORT' ? 'private question' : '[CONTENT_OMITTED]',
      );
      expect(data.totaltokens).toBe(15);
      expect(JSON.stringify(data)).not.toContain('private answer');
    },
  );

  it('returns an eligible low-risk general answer with a fixed prompt version', async () => {
    const { service, send, logCreate } = createService(
      '클라우드는 컴퓨팅 자원을 제공하는 방식입니다.',
    );

    await expect(
      service.createGeneralAnswer(
        { query: '클라우드가 무엇인가요?' },
        { appcode: 'SUPPORT', defaultModelId: 'model-v1' },
        'request-id',
      ),
    ).resolves.toMatchObject({
      generalAnswerEligible: true,
      reviewRecommended: false,
      promptVersion: GENERAL_ANSWER_PROMPT_VERSION,
      requestId: 'request-id',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(logCreate).toHaveBeenCalledTimes(1);
  });

  it('converts the provider veto marker into a review recommendation', async () => {
    const { service } = createService(
      '[[REVIEW_REQUIRED]] 담당자 확인이 필요합니다.',
    );

    await expect(
      service.createGeneralAnswer(
        { query: '이 계약은 유효한가요?' },
        { appcode: 'SUPPORT', defaultModelId: null },
      ),
    ).resolves.toMatchObject({
      answer: '담당자 확인이 필요합니다.',
      generalAnswerEligible: false,
      reviewRecommended: true,
      reviewReasons: ['PROVIDER_REVIEW_RECOMMENDED'],
    });
  });
});
