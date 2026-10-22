export const JEV_INQUIRY_POLICY_VERSION = 'inquiry-v1';
export const JEV_INQUIRY_MIN_CONFIDENCE = 0.7;

export const JEV_INQUIRY_CATEGORIES = {
  product: '상품 종류, 가격, 재고, 상품 위치나 사양 문의',
  refund_exchange: '교환, 반품, 환불의 조건과 가능 여부 문의',
  shipping_order: '주문, 배송, 수령, 주문 취소 문의',
  billing_payment: '결제, 청구, 영수증, 세금계산서 문의',
  technical_support: '설치, 사용 방법, 고장이나 오류 해결 문의',
  store_info: '매장 운영시간, 주소, 층별 구조, 시설 위치 문의',
  complaint: '불만, 항의, 상담원 연결이나 담당자 조치 요청',
  other: '다른 유형, 복합적인 여러 문의, 의도가 불명확한 문의',
} as const;

export type JevInquiryCategory = keyof typeof JEV_INQUIRY_CATEGORIES;

const guidance: Record<JevInquiryCategory, string> = {
  product:
    '상품명, 위치, 가격과 재고 중 질문한 항목을 확인하세요. 등록 자료의 값과 실시간 값을 구분하고 확인되지 않은 상품이나 수치를 만들지 마세요.',
  refund_exchange:
    '자료에 명시된 기한, 영수증, 사용·개봉 여부 등 조건과 질문의 조건을 대조하세요. 없는 예외를 만들거나 실제 교환·환불 처리가 완료됐다고 말하지 마세요.',
  shipping_order:
    '자료에 있는 주문·배송 정책을 안내하세요. 개인 주문 조회 기능이 제공되지 않았다면 실제 주문 상태나 배송일을 추측하지 마세요.',
  billing_payment:
    '자료에 있는 결제·청구 정책과 절차만 안내하세요. 실제 결제 조회·취소·환급을 수행했다고 말하지 마세요.',
  technical_support:
    '자료에서 확인되는 설치·사용·문제 해결 순서만 안내하세요. 자료에 없는 해결 방법이나 고장 원인을 단정하지 마세요.',
  store_info:
    '질문한 운영시간·주소·시설에 관한 확인 가능한 사실만 안내하세요. 일부 상품의 층·구역 위치를 매장 전체 구조로 일반화하지 마세요.',
  complaint:
    '고객의 불편을 간결하게 인정하고 자료에서 확인되는 해결·상담 절차를 안내하세요. 근거 없는 보상이나 처리를 약속하지 마세요.',
  other:
    '질문의 확인 가능한 부분에 일반 근거 규칙을 적용하세요. 의도가 불명확하면 필요한 확인 사항을 안내하세요.',
};

export function createJevInquiryGuidance(
  category: unknown,
): string | undefined {
  if (typeof category !== 'string' || !Object.hasOwn(guidance, category))
    return undefined;
  return `[고객문의 분류에 따른 답변 지침]\n분류: ${category}\n${guidance[category as JevInquiryCategory]}\n분류는 답변 작성의 보조 신호이며 사실 근거가 아닙니다. 사용자 질문 전체와 기존 근거·출력 계약을 우선하세요.`;
}
