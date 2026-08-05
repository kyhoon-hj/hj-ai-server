import { SetMetadata } from '@nestjs/common';

export const API_EXPOSURE_POLICY_KEY = 'api_exposure_policy';

export const API_EXPOSURE_POLICIES = {
  testTable: 'ENABLE_TEST_TABLE_API',
  legacyBedrockInspection: 'ENABLE_LEGACY_BEDROCK_INSPECTION_API',
  legacyKnowledgeWrite: 'ENABLE_LEGACY_KNOWLEDGE_WRITE_API',
} as const;

export type ApiExposurePolicy = keyof typeof API_EXPOSURE_POLICIES;

export const ApiExposure = (policy: ApiExposurePolicy) =>
  SetMetadata(API_EXPOSURE_POLICY_KEY, policy);
