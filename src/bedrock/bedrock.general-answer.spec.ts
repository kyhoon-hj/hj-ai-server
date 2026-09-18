import { BedrockController } from './bedrock.controller';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import {
  BedrockService,
  GENERAL_ANSWER_PROMPT_VERSION,
} from './bedrock.service';

describe('BedrockService general answer contract', () => {
  function createService(response: string) {
    const logCreate = jest.fn().mockResolvedValue({});
    const quota = {
      recordUsage: jest.fn(
        (
          _reservation: unknown,
          write: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          write({
            bedrockSearchLog: { create: logCreate },
          } as unknown as Prisma.TransactionClient),
      ),
      begin: jest.fn().mockResolvedValue({ id: 'reservation' }),
      reserveTokens: jest.fn().mockResolvedValue(undefined),
      settle: jest.fn().mockResolvedValue(undefined),
      markUncertain: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BedrockService(
      {
        get: jest.fn().mockReturnValue('model-v1'),
      } as unknown as ConfigService,
      { bedrockSearchLog: { create: logCreate } } as never,
      quota as never,
    );
    const send = jest.fn().mockResolvedValue({
      output: { message: { content: [{ text: response }] } },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    Object.defineProperty(service, 'client', { value: { send } });
    return { service, send, logCreate, quota };
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
  describe.each(['converse', 'text-response', 'general-answers'])(
    '%s quota contract',
    (endpoint) => {
      function setup() {
        const context = createService('answer');
        const invoke = () =>
          endpoint === 'converse'
            ? context.service.converse(
                { message: 'question', system: 'system', maxTokens: 50 },
                'SUPPORT',
              )
            : endpoint === 'text-response'
              ? context.service.createTextResponse(
                  { message: 'question' },
                  'SUPPORT',
                )
              : context.service.createGeneralAnswer(
                  { query: 'question' },
                  { appcode: 'SUPPORT', defaultModelId: 'model-v1' },
                  'request-id',
                );
        return { ...context, invoke };
      }

      it('reserves once before invocation and settles after the usage log', async () => {
        const { invoke, quota, send, logCreate } = setup();
        await invoke();
        expect(quota.begin).toHaveBeenCalledTimes(1);
        expect(quota.begin).toHaveBeenCalledWith(
          expect.objectContaining({ operationScope: `bedrock.${endpoint}` }),
        );
        expect(quota.recordUsage).toHaveBeenCalledTimes(1);
        expect(quota.recordUsage.mock.calls[0][0]).toEqual({
          id: 'reservation',
        });
        expect(quota.reserveTokens).toHaveBeenCalledTimes(1);
        const command = (send.mock.calls as unknown[][])[0][0] as {
          input: {
            system?: { text: string }[];
            inferenceConfig: { maxTokens: number };
          };
        };
        const expected =
          command.input.inferenceConfig.maxTokens +
          Math.ceil((8 + (command.input.system?.[0].text.length ?? 0)) / 4);
        expect(quota.reserveTokens).toHaveBeenCalledWith(
          { id: 'reservation' },
          expected,
        );
        expect(quota.reserveTokens.mock.invocationCallOrder[0]).toBeLessThan(
          send.mock.invocationCallOrder[0],
        );
        expect(logCreate.mock.invocationCallOrder[0]).toBeLessThan(
          quota.settle.mock.invocationCallOrder[0],
        );
        expect(quota.settle).toHaveBeenCalledWith({ id: 'reservation' }, 15);
        expect(quota.markUncertain).not.toHaveBeenCalled();
      });

      it('does not invoke the provider when request admission fails', async () => {
        const { invoke, quota, send, logCreate } = setup();
        quota.begin.mockRejectedValue(new Error('request limit'));
        await expect(invoke()).rejects.toThrow('request limit');
        expect(send).not.toHaveBeenCalled();
        expect(logCreate).not.toHaveBeenCalled();
        expect(quota.settle).not.toHaveBeenCalled();
      });

      it('releases the reservation when token admission fails', async () => {
        const { invoke, quota, send } = setup();
        quota.reserveTokens.mockRejectedValue(new Error('token limit'));
        await expect(invoke()).rejects.toThrow('token limit');
        expect(send).not.toHaveBeenCalled();
        expect(quota.settle).toHaveBeenCalledWith({ id: 'reservation' }, 0);
      });

      it.each(['provider', 'log'])(
        'retains uncertain usage after %s failure',
        async (stage) => {
          const { invoke, quota, send, logCreate } = setup();
          (stage === 'provider' ? send : logCreate).mockRejectedValue(
            new Error(stage),
          );
          await expect(invoke()).rejects.toThrow(stage);
          expect(quota.markUncertain).toHaveBeenCalledWith({
            id: 'reservation',
          });
          expect(quota.settle).not.toHaveBeenCalled();
        },
      );

      it('does not settle unmeasured usage as zero', async () => {
        const { invoke, quota, send } = setup();
        send.mockResolvedValue({
          output: { message: { content: [{ text: 'answer' }] } },
        });
        await invoke();
        expect(quota.markUncertain).toHaveBeenCalledWith({ id: 'reservation' });
        expect(quota.settle).not.toHaveBeenCalled();
      });

      it('supports unlimited applications without a reservation', async () => {
        const { invoke, quota, send } = setup();
        quota.begin.mockResolvedValue(null);
        await invoke();
        expect(send).toHaveBeenCalledTimes(1);
        expect(quota.settle).toHaveBeenCalledWith(null, 15);
      });
    },
  );
  it.each(['converse', 'createTextResponse'] as const)(
    'forwards the correlation ID from %s for duplicate protection',
    async (method) => {
      const implementation = {
        converse: jest.fn(),
        createTextResponse: jest.fn(),
      };
      const controller = new BedrockController(implementation as never);
      const signal = new AbortController().signal;
      await controller[method]({ message: 'question' }, {
        appInfo: { appcode: 'APP' },
        correlationId: 'request-id',
        abortSignal: signal,
      } as never);
      expect(implementation[method]).toHaveBeenCalledWith(
        { message: 'question' },
        'APP',
        signal,
        'request-id',
      );
    },
  );
});
