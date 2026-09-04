import type { KnowledgeIndexJobItem } from './knowledge-management-contract';

export function failedIndexJobNotice(
  job: KnowledgeIndexJobItem,
  fileName: string,
) {
  if (job.canRetry)
    return `${fileName} 인덱싱이 일시 장애 후 중단됐습니다. 다시 시도할 수 있습니다.`;
  if (job.retryable)
    return `${fileName} 인덱싱의 재시도 횟수를 모두 사용했습니다. 관리자에게 문의해주세요.`;
  return `${fileName} 인덱싱이 영구 실패로 분류됐습니다. 파일·권한·설정을 확인해주세요.`;
}
