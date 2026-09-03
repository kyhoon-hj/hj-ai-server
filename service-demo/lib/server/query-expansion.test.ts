import { describe, expect, it } from 'vitest';
import { expandKnowledgeQuery } from './query-expansion';

describe('expandKnowledgeQuery', () => {
  it('adds tenant and business-hour vocabulary to a terse question', () => {
    expect(expandKnowledgeQuery('STORE_A', '운영시간은?')).toContain('STORE_A 매장의 운영 및 영업 시간');
  });

  it('adds return-policy vocabulary while preserving the customer question', () => {
    const expanded = expandKnowledgeQuery('STORE_B', '환불정책은');
    expect(expanded).toContain('STORE_B 매장의 상품 교환, 반품 및 환불 정책');
    expect(expanded).toContain('고객 질문: 환불정책은');
  });

  it('normalizes a terse product-kind question into a searchable sales question', () => {
    expect(expandKnowledgeQuery('STORE_A', '갓 김치 종류는')).toBe('갓김치 중 판매하는 상품 종류는 무엇인가요?');
    expect(expandKnowledgeQuery('STORE_A', '갓김치 종류는?')).toBe('갓김치 중 판매하는 상품 종류는 무엇인가요?');
  });

  it('does not rewrite unrelated or already detailed questions', () => {
    expect(expandKnowledgeQuery('STORE_A', '대표 전화번호는?')).toBe('대표 전화번호는?');
    const detailed = '멀티탭 3구 2m는 어디에 있고 재고와 가격은 얼마인가요?';
    expect(expandKnowledgeQuery('STORE_A', detailed)).toBe(detailed);
  });
});
