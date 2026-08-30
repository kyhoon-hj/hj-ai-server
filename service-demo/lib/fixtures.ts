export type PersonaId = 'customer' | 'agent' | 'manager';

export interface Persona {
  id: PersonaId;
  label: string;
  role: string;
  goal: string;
  accent: string;
}

export interface Journey {
  id: string;
  personaId: PersonaId;
  title: string;
  description: string;
  prompt: string;
  category: string;
  eta: string;
}

export const storeFixture = {
  id: 'STORE_A',
  name: '한결마트 성수점',
  region: '서울 동부',
} as const;

export const personas: Persona[] = [
  {
    id: 'customer',
    label: '고객 01',
    role: '매장 고객',
    goal: '정확한 상품·정책 답변을 빠르게 확인',
    accent: 'lime',
  },
  {
    id: 'agent',
    label: '상담원 A',
    role: '고객 상담',
    goal: '근거를 확인하고 일관된 안내를 제공',
    accent: 'sky',
  },
  {
    id: 'manager',
    label: '매장 관리자',
    role: '운영 관리',
    goal: '반복 문의와 정책 공백을 파악',
    accent: 'amber',
  },
];

export const journeys: Journey[] = [
  {
    id: 'JOURNEY_RETURN_01',
    personaId: 'customer',
    title: '교환 가능 여부 확인',
    description: '구매 후 7일이 지난 멀티탭의 교환 조건을 확인합니다.',
    prompt: '8일 전에 구매한 멀티탭 포장을 열었는데 교환할 수 있나요?',
    category: '교환·환불',
    eta: '약 30초',
  },
  {
    id: 'JOURNEY_PRODUCT_01',
    personaId: 'customer',
    title: '상품 정보 탐색',
    description: 'LED 스탠드의 밝기 조절과 전원 방식을 묻습니다.',
    prompt: '밝기 조절이 되고 USB-C로 충전하는 LED 스탠드가 있나요?',
    category: '상품 문의',
    eta: '약 20초',
  },
  {
    id: 'JOURNEY_SOURCE_01',
    personaId: 'agent',
    title: '정책 근거 확인',
    description: '답변에 사용된 반품 정책의 문서와 조항을 확인합니다.',
    prompt: '개봉 상품 반품 정책의 근거 문서와 적용 예외를 보여주세요.',
    category: '상담 지원',
    eta: '약 40초',
  },
  {
    id: 'JOURNEY_NOANSWER_01',
    personaId: 'agent',
    title: '답변 불가 처리',
    description: '근거가 부족한 고양이 장난감 재입고 문의를 안전하게 이관합니다.',
    prompt: '품절된 고양이 장난감은 다음 주에 재입고되나요?',
    category: '상담 이관',
    eta: '약 1분',
  },
  {
    id: 'JOURNEY_GAP_01',
    personaId: 'manager',
    title: '지식 공백 점검',
    description: '답변하지 못한 문의 유형과 보완할 정책을 검토합니다.',
    prompt: '이번 주 답변 불가 문의를 유형별로 정리해주세요.',
    category: '운영 인사이트',
    eta: '약 2분',
  },
  {
    id: 'JOURNEY_HOURS_01',
    personaId: 'manager',
    title: '운영 안내 검토',
    description: '명절 영업시간 안내가 최신인지 점검합니다.',
    prompt: '추석 연휴 영업시간 안내 문서의 최근 변경일을 확인해주세요.',
    category: '콘텐츠 점검',
    eta: '약 1분',
  },
];

export const products = [
  { id: 'PRODUCT_POWER_01', name: '6구 안전 멀티탭', category: '생활가전' },
  { id: 'PRODUCT_LIGHT_01', name: 'USB-C LED 스탠드', category: '조명' },
  { id: 'PRODUCT_PET_01', name: '깃털 고양이 장난감', category: '반려용품' },
] as const;

export const policyFixtures = [
  { id: 'POLICY_RETURN_01', title: '교환·환불 정책', revision: 'v3.2' },
  { id: 'POLICY_HOURS_01', title: '매장 운영시간 안내', revision: 'v1.8' },
] as const;
