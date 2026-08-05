import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ApiExposureGuard } from './api-exposure.guard';

describe('ApiExposureGuard', () => {
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  it('명시적 활성화가 없으면 운영 제외 API를 404로 숨긴다', () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('testTable'),
    };
    const guard = new ApiExposureGuard(
      config as unknown as ConfigService,
      reflector as unknown as Reflector,
    );

    expect(() => guard.canActivate(context)).toThrow(NotFoundException);
    expect(config.get).toHaveBeenCalledWith('ENABLE_TEST_TABLE_API');
  });

  it('대응 환경변수가 true일 때만 호환 API를 허용한다', () => {
    const config = { get: jest.fn().mockReturnValue('true') };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('legacyKnowledgeWrite'),
    };
    const guard = new ApiExposureGuard(
      config as unknown as ConfigService,
      reflector as unknown as Reflector,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(config.get).toHaveBeenCalledWith(
      'ENABLE_LEGACY_KNOWLEDGE_WRITE_API',
    );
  });
});
