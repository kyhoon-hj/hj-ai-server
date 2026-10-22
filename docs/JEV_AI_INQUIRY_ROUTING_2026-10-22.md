# Jev 선분류 → Bedrock RAG 연동 적용 결과

실행일: 2026-10-22. HJ AI Server 로컬 서비스 데모에 적용했다.

## 구현

기존 `shadow`는 Bedrock 답변 생성 후 근거를 평가했다. 새 `classify` 모드는 문의를 먼저
Jev `jev-latest`로 분류하고, 그 결과에 해당하는 서버의 고정 지침을 Bedrock Converse의
system 블록에 추가한다. 이후 기존 답변 JSON·인용 검증을 수행한다.

```text
고객 질문 → 앱 인증·사용량 예약 → Jev 문의 분류
       → 기존 자료 검색 → 분류별 지침 + 검색 자료 + 질문
       → AWS Bedrock 답변 생성 → 기존 근거·JSON 검증 → 답변·서버 기록
```

- 분류: 상품, 교환/환불, 주문/배송, 결제/청구, 기술지원, 매장정보, 불만/상담 요청, 기타.
- 선택 확률과 confidence 모두 0.7 이상이면 유형별 지침을 적용한다. 그보다 낮으면 일반 `other` 지침을 사용한다.
- 분류 실패 시 추가 지침 없이 기존 RAG로 진행한다. 분류가 인증·자료 접근 범위·strict 근거 요건을 바꾸지 않는다.
- 검색은 기존 질문과 접근 가능한 자료를 사용한다. 이 단계는 유형별 문서 태그 필터링이나 다른 Bedrock 모델로의 전환을 추가하지 않았다.
- Jev에는 질문만 전송한다. 자료·이전 답변·인증정보·앱 식별자는 전송하지 않는다.
- `classify`와 생성 후 `shadow`는 함께 실행되지 않는다. 문의당 Jev 최대 1회이며 자동 재전송은 없다.
- 분류 및 사용량: `knowledge_query_log.execution.jevClassification`.
- 추가 지침의 해시: `execution.inquiryGuidanceSha256`. Bedrock 예약 입력량에도 추가 지침을 반영했다.
- API 키는 기존 서버 `.env`를 사용하며 새 의존성·DB 마이그레이션은 추가하지 않았다.

주요 변경: `src/jev/jev-inquiry-policy.ts`, `src/jev/jev.service.ts`,
`src/knowledge/knowledge.service.ts`, `src/config/environment.ts`, 관련 테스트와 로컬 비교 실행기.

## 실제 로컬 검증

비교 전용 DB `hj_ai_jev_demo`와 저장소의 공개 예제 자료를 사용했다.
서비스 데모 BFF → 로컬 AI Server → 실제 Jev/Bedrock → DB 기록 경로로 실행했다.
현재 실행 중인 로컬 서버와 루트 `.env`는 `JEV_AI_RAG_MODE="classify"`다.
허용 앱은 `hj-ai-demo-store-a,hj-ai-demo-store-b`다. 운영 배포는 실행하지 않았다.

| 질문 | 선분류 결과 | 실제 답변 핵심 | 검증 |
|---|---|---|---|
| 운영시간은? | `store_info` | 매일 10~22시 | PASS |
| 멀티탭 3구 2m 위치·재고·가격 | `product` | 1층 A-04, 등록 재고 18개, 등록 가격 5,000원 | PASS |
| STORE_A 구매 8일 후 교환 | `refund_exchange` | 7일 기한 초과로 교환 어려움 | PASS |
| STORE_B 구매 8일 후 교환 | `refund_exchange` | 14일 이내이며 조건 충족으로 가능 | PASS |
| 매장의 구조는 | `unavailable` → 기존 RAG | 1층·2층의 등록 구역만 설명, 전체 구조는 확인 불가 | PASS |
| 계단 위치 | `store_info` | 자료에서 확인 불가, 상담원 검토 안내 | PASS |
| STORE_B에서 STORE_A 멀티탭 가격·위치 문의 | `product` | STORE_A 자료를 노출하지 않고 확인 불가 안내 | PASS |

- HTTP 200 및 핵심 사실·거절 조건 **7/7 통과**.
- 선분류 **6/7 성공**, 6건 모두 기대 유형 및 지침 적용 해시 확인.
- 1건은 HTTP 200 뒤 `validationIssue: model`로 분류를 거절했다. 실제 응답의 모델 이름은 보존하지 않아 구체 값은 확정하지 않았다.
- 이 실패 건도 기존 RAG로 정상 답변했다. 원래 요청은 재전송하지 않았으며 이후 두 개의 서로 다른 질문만 이어서 실행했다.
- 7건 모두 후평가 호출이 없고, 고객 답변과 DB 저장 답변이 일치했다.
- 성공한 분류 범주는 매장정보·상품·교환/환불 3종이다. 나머지 5개 범주와 실제 운영 고객 데이터는 추가 검증이 필요하다.
- 기존 생성 모델의 사실 정확도보다 개선됐다는 일반적인 결론을 내리기에는 표본이 작다.

## 비용과 시간

- 시작 잔액 8 → 종료 잔액 **1크레딧**: 문의 7개 × 1크레딧 = **7크레딧**.
- 분류 실패 1건도 청구량 1크레딧으로 확인됐다. 로컬 파싱 실패는 무료나 환불을 뜻하지 않는다.
- Jev 입력 **4,328**토큰, 출력 **558**토큰. 계정은 유료 입력 토큰 0으로 크레딧 결제였다.
- 분류 단계 평균 **867 ms**. 실제 질문의 범위는 560~1,165 ms다.
- Bedrock 답변 생성·검색 임베딩 비용은 별도다. Jev 응답에 USD 비용이 없어 달러·원화로 환산하지 않았다.
- 잔액이 소진되면 분류는 `unavailable`로 기록되고 기존 Bedrock RAG가 계속 처리한다.

## 검증 명령과 결과

- `npm run test:ci`: **67 suites, 562 tests PASS**.
- 마지막 테스트 코드 정리 후 `npm run test:ci -- --runTestsByPath src/knowledge/knowledge.contract.spec.ts`: 29 tests PASS.
- `npm run build`, `npm run typecheck`: PASS.
- `npx --no-install eslint src/jev/*.ts src/config/environment.ts src/config/environment.spec.ts src/knowledge/knowledge.service.ts src/knowledge/knowledge.contract.spec.ts`: PASS.
- `node --check scripts/jev-local-demo.mjs`: PASS.
- `npm run jev:check`: 인증 모델 조회 PASS, 추론 0회.
- `node scripts/jev-local-demo.mjs compare classify`: 5건 실행 후 분류 실패에서 중단.
- 계정 잔액 확인 후 `node scripts/jev-local-demo.mjs compare classify --resume-after-review`: 이미 실행한 질문을 건너뛰고 나머지 2건 완료.
- 테스트에는 선분류 호출 순서, 고정 system 지침, 오류 fallback, 낮은 confidence/확률, 비허용·기록 금지 앱, 취소, strict 무근거 보류, Bedrock 사용량 분리가 포함된다.

실측 자료는 Git 제외 `outputs/jev-local-demo/2026-10-22/`에 보관한다.

- `classify.json`: 질문별 답변·실제 분류·사용량·지침 해시·요청 ID.
- `classify-balance-before.json`, `classify-balance-after.json`: 실제 계정 잔액.

로컬 화면: <http://127.0.0.1:11002/chat>.
고객 화면에는 기존 답변과 근거를 표시하며 분류 상세는 서버 기록에서 확인한다.
재시작 및 설정 방법은 [연동 문서](JEV_AI_INTEGRATION.md)를 참조한다.
