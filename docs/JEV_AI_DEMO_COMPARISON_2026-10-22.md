# 로컬 서비스 데모 Jev 비교 결과

실행일: 2026-10-22. 사용자 선택에 따라 로컬 HJ Mart Assist에서만 수행했다.
후속 파싱 수정·실패 4문항 재검증은 [별도 결과](JEV_AI_PARSING_FIX_RETEST_2026-10-22.md)에 기록했다.
후속 결과는 4/4 정상 처리, 추가 5크레딧 사용(진단 1회 포함), 잔액 8크레딧이다.
아래 최초 실행 결과와 비용은 당시 기록으로 유지한다.
현재 모드는 `shadow`이며, Jev가 기존 답변을 평가하고 결과를 서버 DB에 기록한다.
Jev는 별도의 고객 답변을 생성하거나 기존 답변을 수정하지 않는다.

## 실행 환경과 범위

- 고객 화면: <http://127.0.0.1:11002/chat>
- 실제 요청 경로: 서비스 데모 `/api/answers` → 로컬 AI Server `/knowledge/answers` → Bedrock 생성 → Jev 평가 → DB 기록.
- AI Server: `127.0.0.1:11000`, 비교 전용 로컬 DB: `hj_ai_jev_demo`.
- 기존 로컬 DB를 복제한 뒤 비교 DB에만 현재 마이그레이션을 적용했다. 기존 DB에는 마이그레이션·앱·문서를 추가하지 않았다.
- 복제 시 원본 DB의 pgvector용 `dynamic_library_path`만 비교 DB에 복사했다. 시스템 파일은 변경하지 않았다.
- 허용 앱: `hj-ai-demo-store-a`, `hj-ai-demo-store-b`.
- 자료: 저장소 `demo/fixtures`의 매장 정책·상품 예제. 상품 CSV는 직접 텍스트 색인용 Markdown으로 변환했다.
- 실제 AWS 임베딩·Bedrock 생성·Jev 호출·PostgreSQL 기록을 사용했다. 운영 고객 데이터에 대한 검증은 아니다.
- 요청 모델: `jev-latest`. 실제 목적지: `https://jev-ai.pro/api/v1/systemone`.
- 공개 데모와 운영 AI 서버는 변경하지 않았다. 키는 루트 `.env`에만 두며 서비스 데모에는 전달하지 않는다.

## 질문별 비교

동일한 질문 7개를 비교 모드 OFF와 SHADOW에서 각각 한 번씩 실행했다.
핵심 사실, 근거 존재 여부, 정보 부족 시 거절, 일부 사실의 전체 일반화 방지를 사전 정의한 조건으로 검증했다.
이 소규모 결과를 일반적인 정확도나 환각 감소율로 해석할 수 없다.

| 실제 질문 | 기존 답변 핵심 | SHADOW 답변 핵심 | Jev 서버 기록 |
|---|---|---|---|
| 운영시간은? | 매일 10~22시 | 동일 | HTTP 200 뒤 파싱 실패 |
| 멀티탭 3구 2m는 어디에 있고 재고와 가격은 얼마인가요? | 1층 A-04, 등록 재고 18개, 등록 가격 5,000원 | 같은 사실, 실시간 변동 가능 안내 | HTTP 200 뒤 파싱 실패 |
| STORE_A: 8일 전에 산 미사용 멀티탭과 영수증이 있어요. 교환할 수 있나요? | 7일 기한 초과로 교환 어려움 | 같은 판단 | HTTP 200 뒤 파싱 실패 |
| STORE_B: 8일 전에 산 미사용 상품과 영수증이 있어요. 교환할 수 있나요? | 14일 이내이므로 가능 | 동일 | `supported`, 해당 선택 확률 0.98, confidence 0.97 |
| 매장의 구조는 | 1층 A-04·2층 C-02만 확인, 전체 층수·계단 등은 불명 | 동일 | `supported`, 해당 선택 확률 0.94, confidence 0.92 |
| 계단이 매장 어디에 있나요? | 자료에서 확인 불가, 상담원 검토 안내 | 동일 | 수정 후에도 HTTP 200 뒤 파싱 실패 |
| STORE_B: 멀티탭 3구 2m의 가격과 위치를 알려주세요. | 자료에서 확인 불가, STORE_A 상품 정보 미노출 | 동일 | 검색 정책 자료를 `irrelevant`로 판단, 선택 확률 1.0 |

- 두 모드 모두 HTTP 200 및 핵심 사실·거절 조건 **7/7 통과**.
- 답변 원문은 5쌍이 동일하다. 상품·STORE_A 교환 답변은 표현만 달랐고 검증한 사실은 같았다.
- SHADOW의 고객 답변 7건 모두 서버에 저장된 기존 생성 답변과 동일했다.
- Jev는 전체 7건 중 **3건 정상 기록, 4건 `JEV_AI_INVALID_RESPONSE`**다. 파싱 실패는 성공 판정으로 집계하지 않았다.
- 모델 이름 허용 수정 후에는 4건 중 3건 정상 기록, 계단 질문 1건 파싱 실패다. 수정 후 전체 7개를 재실행한 결과는 아니다.
- Jev 판단을 이용한 문서 제외·답변 수정·게시 차단은 하지 않았다. 따라서 이번 비교로 답변 품질 향상을 입증하지 않았다.

## 확인한 호환성 문제와 수정

실제 다중 판단 응답에서 `model: "typesafe-ai/jev"`가 확인됐다.
문서의 `jev-1.13.0` 예시만 예상하던 파서는 이를 거절했다.
`src/jev/jev-client.ts`에서 확인된 이 식별자만 추가 허용하고 원문 그대로 기록하도록 수정했다.
요청 모델은 계속 `jev-latest`, 요청 호스트는 계속 `jev-ai.pro`다.
응답 이름만으로 실제 버전이 1.13.0이라고 단정하지 않는다.

초기 STORE_A 교환 요청의 제한된 진단 응답에서 이 원인을 직접 확인했다.
상품 요청 진단에서는 관련 근거 `useful` 1.0, 답변 `supported` 0.99가 확인됐지만,
당시 모델 필드는 진단 필터에서 제거되어 모델 이름을 복구할 수 없다. 이 자료는 정상 서버 기록과 구분한다.
운영시간·계단 질문의 원본 응답은 보존하지 않아 파싱 실패의 세부 원인은 확정하지 않았다.
특히 계단 질문은 모델 이름 수정 후에도 실패하여 **추가 호환성 문제가 남아 있다**.

파싱 실패마다 자동 재전송을 중단했다. 계정 실행 내역·잔액을 확인한 뒤 서로 다른 나머지 질문만 진행했다.
비용 증가를 피하기 위해 동일 질문 재실행과 추가 유료 진단은 하지 않았다.
임시 응답 진단 코드는 최종 로컬 실행 스크립트에서 제거했다.

## 지연과 비용

| 항목 | 측정값 |
|---|---:|
| OFF 평균 서버 latencyMs | 1,860 ms |
| SHADOW 평균 서버 latencyMs | 3,137 ms |
| Jev 단계 평균 durationMs | 856 ms |
| Jev 단계 범위 | 479~1,107 ms |
| OFF Bedrock 총 토큰 | 19,829 |
| SHADOW Bedrock 총 토큰 | 19,830 |
| 이번 비교 Jev 요청 | 7회 |
| 비교 시작 크레딧 | 20 |
| 비교 종료 크레딧 | 13 |
| 비교 소모 크레딧 | **7** |
| 종료 유료 입력 토큰 잔액 | 0 |

계정 잔액은 인증된 `GET https://jev-ai.pro/api/v1/credits`로 확인했다.
정상 파싱된 3건의 청구 헤더는 모두 `credits-fallback`, 요청당 1크레딧이다.
파싱 실패 4건도 잔액 차감에 포함된다. 로컬 파싱 실패가 제공자 실행 실패나 환불을 뜻하지 않는다.
이전 단일 연결 확인에 사용한 1크레딧은 위 비교 7크레딧과 별도다.

`usage.cost`가 없어 원화·달러 청구액으로 환산하지 않았다.
자료 색인 임베딩과 Bedrock 생성 총 14회의 AWS 비용도 별도로 발생한다.
평균 응답 차이에는 검색·생성·재시작에 따른 편차가 포함되므로 전부 Jev 지연으로 볼 수 없다.

## 현재 실행 상태와 재시작

루트 `.env`에 다음 공개 설정을 반영했다. 기존 키 값은 변경하거나 출력하지 않았다.

```dotenv
JEV_AI_RAG_MODE="shadow"
JEV_AI_RAG_APPCODES="hj-ai-demo-store-a,hj-ai-demo-store-b"
```

비교 전용 DB를 사용하는 서버와 서비스 데모를 두 터미널에서 실행한다.
일반 서버 실행 명령은 원래 DATABASE_URL을 사용하므로 이 비교 환경에는 아래 실행기를 사용한다.

```powershell
# 프로젝트 루트: 이미 준비·색인된 비교 DB 사용
node scripts/jev-local-demo.mjs server shadow
```

```powershell
# 다른 터미널, 프로젝트 루트에서
npm --prefix service-demo run dev
```

`service-demo/.dev.vars`는 로컬 비교 앱에 연결되어 있다. 이전 설정은 Git 제외 백업
`service-demo/.dev.vars.before-jev-20261022`에 보관했다.
`dev:connected`는 앱 키를 다시 준비하는 명령이므로 이 실행 상태를 유지하려면 `dev`를 사용한다.
서버 비교 결과는 `knowledge_query_log.execution.jev`에서 확인한다. 고객 채팅 화면에는 판단값을 노출하지 않는다.

`scripts/jev-local-demo.mjs`의 `prepare`/`seed`는 초기 비교 DB 준비·예제 자료 색인용이다.
`compare off|shadow`는 실제 유료 호출을 수행하며 기존 결과가 있으면 재실행을 거절한다.
`--resume-after-review`는 기존 결과의 질문을 건너뛰고 아직 실행하지 않은 질문만 진행한다.
이번 결과는 7개가 모두 기록되어 있어 이어서 실행할 질문이 없다.

## 검증과 산출물

- `npm run build`: PASS.
- `npm run typecheck`: PASS.
- `npx --no-install eslint src/jev/jev-client.ts src/jev/jev-client.spec.ts`: PASS.
- `npm run test:ci -- --runTestsByPath src/jev/jev-client.spec.ts src/jev/jev.service.spec.ts src/knowledge/knowledge.contract.spec.ts`: 3 suites, **53 tests PASS**.
- `node --check scripts/jev-local-demo.mjs`: PASS.
- `npm run jev:check`: 인증 모델 조회 PASS, `jev-latest` 사용 가능, 추론 0회.
- 로컬 고객 채팅 화면의 브라우저 렌더링 확인. 실제 질문 비교는 같은 BFF HTTP 경로로 실행했다.
- 앞선 연동 단계 전체 테스트 540건과 이번 수정 이후 관련 테스트 53건을 구분한다.

실제 요청 ID·답변·출처·토큰·판정은 Git 제외 디렉터리에 보관한다.

- `outputs/jev-local-demo/2026-10-22/off.json`
- `outputs/jev-local-demo/2026-10-22/shadow.json`
- `outputs/jev-local-demo/2026-10-22/balance.json`

최초 검증 시점의 판단: shadow 관찰을 유지한다. 응답 형식 문제를 확인하고 더 많은 독립 사례에서
잘못된 승인·과도한 거절을 검증하기 전에는 Jev를 고객 답변의 필수 승인 조건으로 사용하지 않는다.

참고: [공식 SDK 설정 및 응답 형식](https://jev-ai.pro/docs#official-sdk), [실패·재시도 정책](https://jev-ai.pro/docs#errors).
