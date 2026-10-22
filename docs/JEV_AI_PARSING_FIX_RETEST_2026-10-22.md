# Jev 응답 파싱 수정 및 실패 질문 재검증

실행일: 2026-10-22, 최종 잔액 확인 11:24 KST.
로컬 HJ Mart Assist와 비교 전용 DB `hj_ai_jev_demo`에서 검증했다.

## 원인 분석

이전 비교에서 실패한 질문은 운영시간, 상품 위치·재고·가격, STORE_A 교환, 계단 위치의 4개다.
앞선 작업에서 실제 모델 식별자 `typesafe-ai/jev`를 추가 허용했으며 이 동작은 유지한다.

이번에는 저장된 계단 질문·답변·검색 자료로 Jev 진단 요청 1회를 먼저 보냈다.
HTTP 200, 모델 `typesafe-ai/jev`, 두 자료 모두 `irrelevant`로 정상 처리됐다.
이전 계단 오류를 동일 입력에서 재현하지는 못했다.

검사 코드를 조사하면서 **확률 합계 허용 경계의 부동소수점 오류**를 별도로 재현했다.
기존 코드는 합계의 1과의 차이가 0.02 이내면 허용하려 했지만,
`0.49 + 0.49` 및 `0.51 + 0.51`의 차이는 JavaScript에서
`0.020000000000000018`로 계산되어 유효한 경계를 거부했다.
이 두 사례의 테스트가 수정 전 `JEV_AI_INVALID_RESPONSE`로 실패하는 것을 확인했다.

과거 실패 응답 원본이 없어 **이 경계 오류가 이전 계단 요청의 직접 원인이었다고 확정할 수는 없다**.
재현된 코드 결함을 수정하고, 실패했던 네 질문의 현재 정상 처리 여부를 실제 요청으로 확인했다.

## 변경 사항

- `src/jev/jev-client.ts`: 기존 2% 허용 범위의 경계에만 `Number.EPSILON × 선택지 수`의 계산 오차를 반영했다. 확률값·선택지를 임의 보정하거나 정규화하지 않는다.
- 0~1을 벗어난 값, 없는/추가된 선택지, 허용 범위 밖의 합계, 잘못된 모델·응답 형식은 계속 거절한다.
- 파싱 실패에 `validationIssue`를 추가해 JSON·모델·사용량·확률 합계 등 어느 검증이 실패했는지 구분한다.
- `JevError.responseFailure`에는 검증된 청구 숫자, 사용량, 필요한 경우 합계만 보관한다. 원본 요청·응답·인증 헤더·예외 cause는 넣지 않는다. 빠진 수치는 `null`이다.
- `src/jev/jev.service.ts`: 실패 세부 진단과 이미 차감된 비용을 서버의 `execution.jev`에 기록한다. 고객 답변을 바꾸지 않는다.
- `scripts/jev-local-demo.mjs`: `compare shadow --failed`로 이전 `unavailable` 질문만 별도 `shadow-retest.json`에 기록한다. 기존 보고서를 보존하며 자동 재전송을 하지 않는다.

공유 클라이언트의 실제 목적지는 계속 `https://jev-ai.pro/api/v1/systemone`, 요청 모델은 `jev-latest`다.
재검증 응답 모델은 처음 세 건 `typesafe-ai/jev`, 계단 건 `jev-1.13.0`으로 관찰됐다.
반환된 이름을 그대로 기록하며 별칭에서 구체 버전을 추정하지 않는다.

## 실제 재비교 결과

기존 OFF 답변은 최초 비교 기록을 기준으로 사용했다. 불필요한 Bedrock 호출을 늘리지 않도록
이번에는 OFF를 다시 실행하지 않고 실패했던 SHADOW 질문 4개만 재실행했다.

| 질문 | 기존 OFF 답변 핵심 | 수정 후 답변 핵심 | 수정 후 Jev 판정 | 결과 |
|---|---|---|---|---|
| 운영시간은? | 매일 10~22시 | 동일 | `supported` 확률 1.0, confidence 1.0 | PASS |
| 멀티탭 3구 2m는 어디에 있고 재고와 가격은 얼마인가요? | 1층 A-04, 등록 재고 18개, 등록 가격 5,000원 | 동일 | `supported` 확률 1.0, confidence 1.0 | PASS |
| STORE_A: 8일 전에 산 미사용 멀티탭과 영수증이 있어요. 교환할 수 있나요? | 7일 초과로 교환 어려움 | 동일 | `supported` 확률 0.97, confidence 0.96 | PASS |
| 계단이 매장 어디에 있나요? | 자료에서 확인 불가, 상담원 검토 안내 | 동일, `answerable=false`, 공개 근거 0개 | 두 검색 자료 `irrelevant`, 선택 확률 각각 1.0·0.89 | PASS |

- 4/4 HTTP 200, 4/4 Jev `evaluated`, 4/4 핵심 사실·거절 조건 통과.
- 4/4 고객 답변과 서버 저장 답변 일치. 이번 재검증 답변은 기존 OFF 답변 원문과도 모두 같다.
- 새 파싱 오류 0건. 계단 질문은 답변 근거 판정을 억지로 만들지 않고 검색 자료 관련성만 평가했다.
- Jev 평가 시간: 1,110 / 520 / 749 / 612 ms, 평균 **748 ms**.
- Jev 사용량: 입력 **5,023**토큰, 출력 **577**토큰. 출력 무료 정책과 별개로 사용량은 그대로 보관했다.
- 소규모 재검증이며 간헐적인 제공자 응답 변동이 완전히 사라졌음을 보장하지 않는다. shadow 모드를 유지한다.

## 비용

| 항목 | 사용량 |
|---|---:|
| 시작 잔액 | 13크레딧 |
| 계단 질문 진단 | 1요청 / 1크레딧 |
| 실패 질문 재검증 | 4요청 / 4크레딧 |
| 이번 작업 합계 | **5크레딧** |
| 종료 잔액 | **8크레딧** |
| 유료 입력 토큰 잔액 | 0 |

`GET /api/v1/credits`의 실제 계정 잔액과 각 응답의 청구 헤더로 확인했다.
추가 진단 입력 1,036·출력 109토큰은 위 재검증 4건의 토큰 합계와 별도다.
Bedrock 생성 4회와 검색 임베딩의 AWS 비용은 별도이며, USD 비용이 응답에 없어 원화·달러로 환산하지 않았다.

## 검증

- 수정 전 경계 회귀 테스트: 2건 FAIL로 결함 재현.
- 수정 후 `npm run test:ci -- --runTestsByPath src/jev/jev-client.spec.ts src/jev/jev.service.spec.ts src/knowledge/knowledge.contract.spec.ts`: **3 suites, 62 tests PASS**.
- 범위 밖 합계, 잘못된 확률·선택지, 잘못된 JSON의 거절 및 비밀 정보 없는 청구 진단 보존 검증 포함.
- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npx --no-install eslint src/jev/jev-client.ts src/jev/jev-client.spec.ts src/jev/jev.service.ts src/jev/jev.service.spec.ts`: PASS.
- `node --check scripts/jev-local-demo.mjs`: PASS.
- `npm run jev:check`: 인증 모델 조회 PASS, 추론 0회.
- `node scripts/jev-local-demo.mjs compare shadow --failed`: 실제 로컬 BFF → AI Server → Bedrock/Jev → PostgreSQL 경로, 4/4 PASS.

실측 기록은 Git 제외 경로에 보관한다.

- `outputs/jev-local-demo/2026-10-22/stairs-diagnosis.json`: 제한된 진단 응답과 청구량.
- `outputs/jev-local-demo/2026-10-22/shadow-retest.json`: 질문별 실제 답변·출처·요청 ID·Jev 판정·사용량.
- `outputs/jev-local-demo/2026-10-22/retest-balance.json`: 최종 잔액.

로컬 서버를 수정 빌드로 재시작했고 현재 shadow 모드로 실행 중이다.
고객 화면: <http://127.0.0.1:11002/chat>.
재시작 방법은 [최초 비교 보고서](JEV_AI_DEMO_COMPARISON_2026-10-22.md)의 로컬 실행 절차를 따른다.

참고: [Jev 응답·청구 형식](https://jev-ai.pro/docs#response), [실패·재시도 정책](https://jev-ai.pro/docs#errors).
