import { createRagQueryGuidance } from './rag-query-guidance';

describe('RAG query guidance', () => {
  it.each(['매장의 구조는', '매장의 총 층수는', '매장이 몇 층인가요?'])(
    'adds partial-inference guidance for store layout questions: %s',
    (query) => {
      const guidance = createRagQueryGuidance(query);

      expect(guidance).toContain('상품 위치');
      expect(guidance).toContain('answerable:true');
      expect(guidance).toContain('전체 층수는 확인할 수 없다');
    },
  );

  it('does not add layout guidance to unrelated questions', () => {
    expect(createRagQueryGuidance('교환 기간은 며칠인가요?')).toBeNull();
  });
});
