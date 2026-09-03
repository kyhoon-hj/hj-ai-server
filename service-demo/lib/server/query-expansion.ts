import type { TenantId } from '@/lib/knowledge-contract';

const TERSE_QUERY_MAX_LENGTH = 24;

export function expandKnowledgeQuery(tenantId: TenantId, query: string): string {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (normalized.length > TERSE_QUERY_MAX_LENGTH) return normalized;

  if (/(운영|영업)\s*시간|몇\s*시.*(열|닫|까지)|문.*(열|닫)/.test(normalized)) {
    return `${tenantId} 매장의 운영 및 영업 시간, 문을 여는 시각과 닫는 시각. 고객 질문: ${normalized}`;
  }

  if (/(교환|환불|반품)/.test(normalized)) {
    return `${tenantId} 매장의 상품 교환, 반품 및 환불 정책, 구매 후 가능 기간, 영수증과 미사용 조건. 고객 질문: ${normalized}`;
  }

  const productKind = normalized.match(/^(.+?)\s*종류(?:는|가|를|이)?\s*[?？]?$/);
  if (productKind) {
    const subject = productKind[1].replace(/\s+/g, '');
    return `${subject} 중 판매하는 상품 종류는 무엇인가요?`;
  }

  return normalized;
}
