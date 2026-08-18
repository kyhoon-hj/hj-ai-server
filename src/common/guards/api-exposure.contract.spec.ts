import {
  API_EXPOSURE_POLICIES,
  API_EXPOSURE_POLICY_KEY,
  type ApiExposurePolicy,
} from './api-exposure.decorator';
import { BedrockController } from '../../bedrock/bedrock.controller';
import { KnowledgeController } from '../../knowledge/knowledge.controller';
import { TestTableController } from '../../test-table/test-table.controller';

function methodPolicy(
  controller: object,
  method: string,
): ApiExposurePolicy | undefined {
  const handler = (controller as Record<string, unknown>)[method];
  if (typeof handler !== 'function') {
    return undefined;
  }
  const metadata = Reflect.getMetadata(
    API_EXPOSURE_POLICY_KEY,
    handler,
  ) as unknown;
  if (typeof metadata !== 'string' || !(metadata in API_EXPOSURE_POLICIES)) {
    return undefined;
  }
  return metadata as ApiExposurePolicy;
}

describe('운영 API 노출 계약', () => {
  it.each(['getConfig', 'listFoundationModels'])(
    'Legacy Bedrock %s 경로를 기본 차단한다',
    (method) => {
      expect(methodPolicy(BedrockController.prototype, method)).toBe(
        'legacyBedrockInspection',
      );
    },
  );

  it.each([
    'uploadKnowledgeFile',
    'updateKnowledgeFilePolicy',
    'deleteKnowledgeFile',
    'createKnowledgeText',
    'seedDemoStoreKnowledge',
    'indexKnowledgeFile',
    'reindexKnowledgeFile',
  ])('Legacy 지식 쓰기 %s 경로를 기본 차단한다', (method) => {
    expect(methodPolicy(KnowledgeController.prototype, method)).toBe(
      'legacyKnowledgeWrite',
    );
  });

  it('test-tables controller 전체를 기본 차단한다', () => {
    expect(
      Reflect.getMetadata(
        API_EXPOSURE_POLICY_KEY,
        TestTableController,
      ) as ApiExposurePolicy,
    ).toBe('testTable');
  });
});
