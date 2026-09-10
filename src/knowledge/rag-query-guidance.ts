const STORE_LAYOUT_QUERY =
  /(?:매장.{0,8}(?:구조|층수|몇\s*층)|총\s*층수|층이\s*몇)/u;

export function createRagQueryGuidance(query: string): string | null {
  if (!STORE_LAYOUT_QUERY.test(query.replace(/\s+/g, ' ').trim())) {
    return null;
  }

  return [
    '이 질문은 상품 위치에 기록된 층과 구역을 집계해 관측 가능한 매장 배치를 설명하는 질문입니다.',
    '참고자료에 상품 위치가 있으면 확인된 층 목록과 각 층의 상품·구역을 답하고 answerable:true로 판정하세요.',
    '총 층수는 확정하지 말고 서로 다른 층 표기의 개수를 기준으로 “자료에서 N개 층이 확인되며 전체 층수는 확인할 수 없다”라고 구분하세요. 가장 높은 층 번호를 층 개수로 간주하지 마세요.',
  ].join(' ');
}
