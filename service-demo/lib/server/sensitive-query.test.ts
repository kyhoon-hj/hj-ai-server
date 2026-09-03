import { describe, expect, it } from 'vitest';
import { containsSensitiveCustomerData } from './sensitive-query';

describe('sensitive customer query detection', () => {
  it.each([
    '답변을 user@example.com으로 보내주세요',
    '제 전화번호는 010-1234-5678입니다',
    '주민번호 900101-1234567',
    '주문번호 ORDER-123456 상태를 알려주세요',
  ])('detects representative personal data before upstream logging: %s', (query) => {
    expect(containsSensitiveCustomerData(query)).toBe(true);
  });

  it.each(['갓김치 1KG 가격은?', '상품코드 STORE_A_MULTITAP 재고는?', '운영시간은?'])('allows ordinary product and policy questions: %s', (query) => {
    expect(containsSensitiveCustomerData(query)).toBe(false);
  });
});
