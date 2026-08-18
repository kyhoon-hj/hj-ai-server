# AI Server·검증 데모·서비스 데모 통합 로드맵

최초 작성일: 2026-08-05
개정일: 2026-08-18
상태: 실행 기준 문서
적용 범위: `src/`, `prisma/`, `demo/`, `service-demo/`, 배포 및 운영 설정

## 1. 목적

AI Server를 공통 제품 기반으로, 검증 데모를 실행 가능한 품질 계약으로, 서비스 데모를 실제 사용자 여정과 요구사항을 확인하는 소비자 애플리케이션으로 발전시킵니다. 모든 서버 개선은 대응하는 자동 검증 증거를 가져야 하며, 서비스 데모는 검증을 통과한 안정 계약만 사용합니다. 최종적으로 외부 앱이 사용할 `/v1` 공통 API 명세와 운영 승인 기준을 확정합니다.

세 영역의 역할은 다음과 같이 구분합니다.

| 영역                        | 역할                                                          | 완료의 의미                                                 |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| AI Server                   | 인증, tenant, 지식, RAG, 파일, 운영 계약을 제공하는 제품 기반 | 공개 계약과 SLO를 만족하고 운영 가능한 상태                 |
| 검증 데모 `demo/`           | 계약·보안·품질·성능 회귀를 자동 판정하는 검증 도구            | 변경마다 반복 실행되고 승인 증거를 생성하는 상태            |
| 서비스 데모 `service-demo/` | 마트 고객응대와 이후 매출 분석의 실제 사용자 경험             | 검증된 API로 대표 업무 여정이 처음부터 끝까지 동작하는 상태 |

## 2. 진행 원칙

1. 서비스 사용자 여정과 성공 기준을 먼저 정의합니다.
2. 문제를 재현하거나 계약을 보장하는 검증 데모 시나리오를 작성합니다.
3. AI Server를 수정한 뒤 동일 시나리오가 PASS하는지 확인합니다.
4. 검증을 통과한 공개 계약만 서비스 데모에 연결합니다.
5. 회귀 가능성이 있는 문제는 자동 계약·통합 시험으로 남깁니다.
6. DB를 직접 확인하지 않고 외부 계약은 HTTP 응답으로 판정합니다.
7. tenant 격리, 인증과 데이터 노출 문제는 성능보다 먼저 해결합니다.
8. Bedrock 호출은 항상 명시적 `maxTokens`를 사용합니다.
9. 부하는 Smoke → Baseline → Burst 순으로 높입니다.
10. 실제 질문·응답이 저장되는 리포트와 서비스 fixture에는 개인정보를 사용하지 않습니다.
11. 단계별 Exit Gate를 통과하기 전 다음 단계의 운영 승인을 하지 않습니다.
12. 고객응대 MVP를 먼저 완성하고, 매출 분석은 정형 집계 계약을 별도로 확보한 뒤 확장합니다.

## 3. 현재 기준선

| 항목                  | 현재 상태                                              | 목표                                   |
| --------------------- | ------------------------------------------------------ | -------------------------------------- |
| AI Server build       | PASS                                                   | 계속 PASS                              |
| 단위 테스트           | 67/67 PASS                                             | 핵심 서비스 branch 80% 이상            |
| 검증 데모 자체 테스트 | 6/6 PASS                                               | 시나리오·fixture 변경마다 계속 PASS    |
| E2E                   | 환경 의존 시험 수동 실행                               | 외부·관리·지식 생명주기 전체 자동 실행 |
| line coverage         | 30.34%                                                 | 핵심 서비스 80% 이상                   |
| typecheck             | PASS                                                   | 계속 PASS                              |
| lint                  | PASS                                                   | 계속 PASS                              |
| dependency audit      | 전체 High 9, Moderate 5; production High 8, Moderate 5 | High 0 또는 승인 예외                  |
| DB migration          | 로컬 readiness PASS, 재배포 전 status 재확인 필요      | 배포 환경과 schema 일치                |
| 검증 데모             | 핵심 계약·보안·parser 검증과 제한 성능 러너            | 전체 자동 검증 및 승인 리포트          |
| 서비스 데모           | 미구현                                                 | 마트 고객응대 MVP 후 매출 분석 확장    |
| 외부 API              | 기존 내부 endpoint 혼재                                | `/v1` 안정 계약 확정                   |
| 관리자 API            | API key 기반 관리자·지식 운영자 RBAC 적용              | identity 기반 인증과 감사 보존 정책    |
| 관측성                | correlation ID와 DB log 일부                           | 로그·metric·trace·alert 연결           |

기준선 수치는 코드 또는 환경 변경 시 다시 측정하고 이 표와 실행 리포트를 함께 갱신합니다.

## 4. 공통 작업 사이클

각 작업은 다음 순서로 수행합니다.

```text
서비스 사용자 여정·성공 기준 정의
  → 검증 데모 재현 case 작성
  → 현재 서버에서 실패 또는 계약 공백 확인
  → 서버 개선 및 단위/통합 시험
  → 검증 데모 case PASS
  → 서비스 데모에 안정 계약 연결
  → 성능·보안 회귀 확인
  → 문서와 OpenAPI 갱신
```

세 영역을 같은 비중으로 동시에 개발하지 않습니다. 단계 0~3에서는 AI Server와 검증 데모에 작업량의 약 70~80%를 배정하고 서비스 데모는 핵심 사용자 여정만 얇게 연결합니다. 단계 4 이후 계약이 안정되면 서비스 데모 비중을 점진적으로 높입니다.

작업 상태는 다음 표기를 사용합니다.

- `[ ]` 예정
- `[~]` 진행 중
- `[x]` 완료 및 증거 확보
- `[!]` 차단됨

## 5. 단계별 실행 계획

### 단계 0 — 재현 가능한 기준 환경

목표: 모든 개발자가 같은 DB schema와 동일한 fixture로 결과를 재현합니다.

#### 데모

- [x] `ENV-DEM-01` STORE_A/STORE_B fixture와 app 생성 절차 자동화
- [x] `ENV-DEM-02` fixture 업로드·인덱싱·게시를 한 번에 실행하는 setup scenario
- [x] `ENV-DEM-03` 테스트 데이터 정리 scenario와 명시적 파괴 작업 확인
- [x] `ENV-DEM-04` 실행 환경, 서버 commit, scenario version을 리포트에 기록
- [ ] `QLT-DEM-01` build·typecheck·lint·unit·demo test CI 게이트와 결과 보존

#### AI Server

- [x] `ENV-SRV-01` 미적용 migration preflight 및 적용
- [~] `ENV-SRV-02` migration 중복 appcode 확인 완료, 중복 데이터 복구 리허설 예정
- [x] `ENV-SRV-03` startup 필수 환경변수 validation
- [x] `ENV-SRV-04` live/readiness endpoint 분리
- [~] `QLT-SRV-01` typecheck·lint 오류 0건 완료, production dependency High 정리 예정

#### 서비스 데모

- [ ] `ENV-SVC-01` `service-demo/` 독립 애플리케이션 골격과 실행 설정
- [ ] `ENV-SVC-02` 마트 고객·상담원·매장 관리자 persona와 대표 사용자 여정 정의
- [ ] `ENV-SVC-03` 실제 개인정보가 없는 상품·정책·문의 fixture와 화면 상태 정의
- [ ] `ENV-SVC-04` API client, correlation ID, 오류 표시의 공통 계층 구성

#### Exit Gate

- DB migration status가 최신입니다.
- 새 DB에서 migrate → seed → 전체 정리가 반복 가능합니다.
- 데모가 target URL, commit, fixture version을 리포트에 남깁니다.
- live는 프로세스, ready는 DB와 필수 dependency 상태를 구분합니다.
- 서비스 데모가 로컬 AI Server를 대상으로 실행되고 health·오류 상태를 사용자에게 구분해 표시합니다.
- build, typecheck, lint, 서버 단위 테스트와 검증 데모 자체 테스트가 CI에서 모두 PASS합니다.

### 단계 1 — 인증·권한·tenant 경계

목표: 외부 노출 전 Critical 위험을 제거합니다.

#### 데모

- [x] `SEC-DEM-01` 관리자 인증 없음·오류 키와 appkey 변조·비활성 자동 시나리오
- [x] `SEC-DEM-02` 키 재발급 후 이전 키 폐기 검증
- [x] `SEC-DEM-03` STORE_A/STORE_B 양방향 파일·검색·답변 source tenant isolation
- [x] `SEC-DEM-04` 플랫폼 관리자·지식 운영자·외부 소비자 role matrix와 RBAC 6건
- [x] `SEC-DEM-05` Swagger 비노출·CORS 허용/비허용 Origin 자동 검증 4건

#### AI Server

- [x] `SEC-SRV-01` AppInfo platform-admin과 지식 운영자 API 역할 RBAC
- [x] `SEC-SRV-02` 외부 appkey와 관리자 credential 분리
- [x] `SEC-SRV-03` 고정 appkey secret fallback 제거 및 전용 secret 누락 시 fail-closed
- [x] `SEC-SRV-04` appkey 만료·제한된 grace 회전, 관리자 이중 키 교체와 감사 이벤트 정책
- [x] `SEC-SRV-05` `test-tables`, demo seed, config/models·legacy 지식 쓰기 기본 차단 및 관리자 대체 경로
- [x] `SEC-SRV-06` exact-origin CORS allowlist 및 운영 Swagger 명시적 활성화 정책

#### 서비스 데모

- [ ] `SEC-SVC-01` 브라우저에 관리자·지식 운영자 credential을 노출하지 않는 BFF 경계
- [ ] `SEC-SVC-02` STORE_A/STORE_B tenant context 전환과 교차 데이터 비노출 화면 검증
- [ ] `SEC-SVC-03` 고객·상담원·매장 관리자별 메뉴와 동작 권한 분리
- [ ] `SEC-SVC-04` 로그·화면·오류 메시지의 credential 및 개인정보 비노출

#### Exit Gate

- 관리자 API 무인증 접근은 모두 401/403입니다.
- tenant 교차 접근과 검색 결과 노출은 0건입니다.
- 기본 회전에서는 이전 키가 즉시 폐기되고, 명시한 제한된 grace 회전에서는 종료 시각 뒤 사용할 수 없습니다.
- 외부 소비자 키로 모델·system prompt·한도를 변경할 수 없습니다.
- 서비스 데모의 브라우저 요청과 저장소에 관리자 credential이 남지 않습니다.
- 역할별 화면과 AI Server 권한 판정이 일치하며 UI 숨김만으로 권한을 통제하지 않습니다.

### 단계 2 — 지식 전체 생명주기와 파일 안전성

목표: 업로드부터 답변과 삭제까지 모든 기능을 자동 검증합니다.

#### 데모

- [x] `KNW-DEM-01` 현재 지원 형식 MD/CSV/PDF/DOCX/XLSX fixture 구성과 parser 회귀 자동화
- [ ] `KNW-DEM-02` upload → index → policy → search → answer 자동 흐름
- [ ] `KNW-DEM-03` reindex, archive, S3 삭제와 중복 실행 시나리오
- [ ] `KNW-DEM-04` 확장자 위장·빈 문서·손상 문서·대용량 문서 시나리오
- [ ] `KNW-DEM-05` DRAFT/PUBLISHED/RETIRED, 기간, productCode, accessLevel matrix

#### AI Server

- [ ] `KNW-SRV-01` Multer 수신 단계 file/field/part size 제한
- [ ] `KNW-SRV-02` MIME signature와 확장자 교차 검증
- [ ] `KNW-SRV-03` S3 업로드·다운로드 streaming 전환
- [ ] `KNW-SRV-04` upload와 DB record 실패 보상 처리
- [ ] `KNW-SRV-05` archive·chunk 삭제·S3 삭제 일관성 개선
- [ ] `KNW-SRV-06` 취약한 XLS/XLSX parser 교체 또는 격리

#### 서비스 데모 — 마트 고객응대 MVP

- [ ] `KNW-SVC-01` 고객 채팅, 추천 질문과 대화 상태 화면
- [ ] `KNW-SVC-02` 답변 근거 문서·페이지·상품·정책 출처 표시
- [ ] `KNW-SVC-03` strict no-answer와 상담원 연결·검토 요청 흐름
- [ ] `KNW-SVC-04` 매장 관리자 문서 업로드·게시 상태·오류 확인 화면
- [ ] `KNW-SVC-05` 환불·교환·운영시간·상품 문의 end-to-end 대표 시나리오

#### Exit Gate

- 지원 형식의 정상 fixture가 모두 검색 가능한 상태가 됩니다.
- 허용되지 않은 파일은 전체 buffer 적재 전에 거절됩니다.
- 대용량 업로드·다운로드에서 process memory가 파일 크기에 비례해 증가하지 않습니다.
- 정책 필터의 PostgreSQL vector 경로와 fallback 경로 결과가 일치합니다.
- 서비스 데모에서 질문 → 검색 → 근거 있는 답변 또는 명시적 no-answer 흐름이 끝까지 동작합니다.
- 서비스 화면에 표시된 source가 검증 데모의 tenant·정책 계약과 일치합니다.

### 단계 3 — 비동기 인덱싱과 장애 복원력

목표: 느린 외부 dependency와 부분 실패에도 API가 예측 가능한 상태를 유지합니다.

#### 데모

- [ ] `REL-DEM-01` 인덱싱 job 제출·조회·완료·실패·재시도 화면과 scenario
- [ ] `REL-DEM-02` Bedrock 429, timeout, 5xx fault injection
- [ ] `REL-DEM-03` S3 없음·DB 오류·embedding 부분 실패 시나리오
- [ ] `REL-DEM-04` 동일 요청 중복 제출과 idempotency 검증
- [ ] `REL-DEM-05` 오류 code와 retry-after 계약 검증

#### AI Server

- [ ] `REL-SRV-01` 인덱싱을 queue 기반 비동기 job으로 전환
- [ ] `REL-SRV-02` chunk embedding 동시성 제한
- [ ] `REL-SRV-03` retryable 오류만 adaptive retry 적용
- [ ] `REL-SRV-04` 요청 timeout, abort 전파와 graceful shutdown
- [ ] `REL-SRV-05` idempotency key와 중복 job 제어
- [ ] `REL-SRV-06` DLQ 또는 수동 복구 가능한 failed 상태

#### 서비스 데모

- [ ] `REL-SVC-01` 파일 업로드·인덱싱 job 진행·완료·실패 상태 표시
- [ ] `REL-SVC-02` retry 가능한 오류에만 재시도 동작 제공
- [ ] `REL-SVC-03` 중복 제출 방지와 사용자 재클릭 안전성
- [ ] `REL-SVC-04` timeout·일시 장애·영구 실패별 안내와 correlation ID 표시

#### Exit Gate

- retry 대상 429/timeout/일시적 5xx는 제한 횟수 내 복구됩니다.
- validation·권한·리소스 없음 오류는 재시도하지 않습니다.
- 실패한 인덱싱이 이전 정상 chunk를 손상시키지 않습니다.
- 재시작 후 진행 중 job을 확인하거나 안전하게 재처리할 수 있습니다.
- 서비스 데모는 장시간 작업을 요청 timeout으로 오인하지 않고 job 상태로 추적합니다.
- 사용자가 같은 작업을 반복해도 중복 지식이나 중복 job이 생성되지 않습니다.

### 단계 4 — RAG 품질과 안전성

목표: “응답 생성 성공”이 아니라 근거가 맞고 추측하지 않는지를 정량화합니다.

#### 데모

- [ ] `RAG-DEM-01` 최소 50개 golden question dataset
- [ ] `RAG-DEM-02` expectedAnswerable, expectedSource, requiredFacts, forbiddenFacts 평가
- [ ] `RAG-DEM-03` strict no-answer와 supplemental source 평가
- [ ] `RAG-DEM-04` prompt injection·내부정보·개인정보 요청 dataset
- [ ] `RAG-DEM-05` 모델·prompt·chunk 설정별 결과 비교 리포트

#### AI Server

- [ ] `RAG-SRV-01` prompt version과 model configuration 고정·기록
- [ ] `RAG-SRV-02` source를 지시문이 아닌 불신 데이터로 구분하는 prompt 구조
- [ ] `RAG-SRV-03` 검색 score와 answerable 판정 기준 보정
- [ ] `RAG-SRV-04` chunk 크기·overlap·structured row 전략 보정
- [ ] `RAG-SRV-05` 필요 시 Bedrock Guardrail 적용 방식 별도 결정
- [ ] `RAG-SRV-06` PII log 마스킹·암호화·보존기간 적용

#### 서비스 데모

- [ ] `RAG-SVC-01` golden question을 실제 고객 대화 흐름으로 실행하는 시연 모드
- [ ] `RAG-SVC-02` 답변 가능·불가능·검토 필요 상태의 명확한 UX
- [ ] `RAG-SVC-03` 상담원이 답변과 source를 검토하고 피드백을 남기는 화면
- [ ] `RAG-SVC-04` prompt injection·개인정보·내부정보 요청에 대한 안전한 사용자 안내
- [ ] `RAG-SVC-05` 모델·prompt·chunk version을 운영자 진단 정보로 추적

#### Exit Gate

- 예상 source 적중률 90% 이상입니다.
- strict no-answer 정확도 95% 이상입니다.
- tenant·정책 필터 위반 source 노출은 0건입니다.
- prompt injection critical dataset의 정책 우회는 0건입니다.
- 품질 저하 시 model/prompt/chunk version으로 원인을 추적할 수 있습니다.
- 대표 고객 여정에서 답변 상태와 출처를 비기술 사용자도 이해할 수 있습니다.
- 상담원 피드백이 품질 dataset 개선으로 환류될 수 있습니다.

Guardrail을 적용하더라도 원본 PII가 모델 invocation log에 남을 수 있으므로, masking만으로 로그 규정 준수를 달성했다고 판정하지 않습니다.

### 단계 5 — 쿼터·성능·비용

목표: 예상 트래픽에서 SLO를 충족하고 Bedrock quota와 비용을 설명할 수 있게 합니다.

#### 데모

- [ ] `PERF-DEM-01` 검색 시간과 생성 시간을 분리 기록
- [ ] `PERF-DEM-02` input/output/total token과 maxTokens를 함께 기록
- [ ] `PERF-DEM-03` Smoke/Baseline/Burst preset과 비교 리포트
- [ ] `PERF-DEM-04` 429·timeout·retry 횟수와 최종 성공률 표시
- [ ] `PERF-DEM-05` 30분 이상 soak는 전용 도구 결과를 import

#### AI Server

- [ ] `PERF-SRV-01` 모든 Bedrock endpoint 공통 rate limit·동시성 제한
- [ ] `PERF-SRV-02` 모든 AI endpoint에 월 token quota 적용
- [ ] `PERF-SRV-03` quota 확인·예약·정산의 원자성 확보
- [ ] `PERF-SRV-04` model allowlist와 endpoint별 maxTokens 상한
- [ ] `PERF-SRV-05` CloudWatch Bedrock metric 및 애플리케이션 metric 연결
- [ ] `PERF-SRV-06` 필요 시 geographic cross-region inference profile 검토

#### 서비스 데모

- [ ] `PERF-SVC-01` 응답 대기·streaming 또는 단계별 진행 상태 UX
- [ ] `PERF-SVC-02` 429·timeout·quota 초과의 사용자 친화적 안내
- [ ] `PERF-SVC-03` 고객응대 핵심 여정의 프론트엔드 체감 시간 측정
- [ ] `PERF-SVC-04` 운영자용 요청량·성공률·지연·token 요약 화면

#### 측정 항목

- 애플리케이션 p50/p95/p99 latency와 throughput
- `Invocations`, `InvocationThrottles`, `InvocationLatency`
- `InputTokenCount`, `OutputTokenCount`
- 설정 `maxTokens`와 실제 output token p95
- retry 전후 성공률과 추가 latency
- appcode·endpoint·model별 토큰 사용량

Bedrock는 요청 시작 시 입력 토큰과 `maxTokens`를 중심으로 TPM을 예약하므로, throttling이 발생하면 먼저 실제 output token 분포에 비해 `maxTokens`가 과도한지 확인합니다. 그 다음 현재 quota와 peak CloudWatch 사용량을 비교하고 quota 증가나 inference profile 변경을 판단합니다.

#### Exit Gate

- 비 AI API p95 500ms 이하입니다.
- vector 검색 p95 1.5초 이하입니다.
- RAG 전체 p95 10초 이하입니다.
- 예상하지 않은 5xx 0.5% 이하입니다.
- quota 초과는 정의된 429와 correlation ID로 응답합니다.
- 모델별 maxTokens 결정 근거와 capacity headroom을 문서화합니다.
- 서비스 데모의 고객 질문 여정이 승인된 RAG SLO 안에서 완료됩니다.
- 느린 응답과 제한 초과가 무응답 또는 무한 로딩으로 보이지 않습니다.

초기 수치는 staging 기준이며 baseline 수집 후 실제 SLO로 승인합니다.

### 단계 6 — `/v1` 공통 API 확정과 배포 게이트

목표: 내부 구현에서 분리된 외부 앱 안정 계약을 릴리스합니다.

#### 데모

- [ ] `API-DEM-01` `/v1/answers`, `/v1/general-answers`, 선택적 `/v1/search` contract suite
- [ ] `API-DEM-02` generated client compile·호출 sample
- [ ] `API-DEM-03` OpenAPI breaking change 비교
- [ ] `API-DEM-04` 전체 승인 리포트 HTML/JSON export
- [ ] `API-DEM-05` CI와 staging smoke 실행 연결

#### AI Server

- [~] `API-SRV-01` 지식 `/admin/v1/knowledge` 완료, 외부 `/v1`·플랫폼 `/admin/v1/apps` 예정
- [ ] `API-SRV-02` 오류 code와 retry 가능 여부 표준화
- [ ] `API-SRV-03` OpenAPI를 source of truth로 정비
- [ ] `API-SRV-04` 기존 endpoint 호환·폐기 일정 정의
- [ ] `API-SRV-05` 구조화 로그·metric·trace·alert와 runbook
- [ ] `API-SRV-06` dependency audit와 image scan 배포 게이트

#### 서비스 데모

- [ ] `API-SVC-01` 내부 endpoint 의존 제거와 `/v1` generated client 적용
- [ ] `API-SVC-02` 고객응대 대표 여정 smoke suite
- [ ] `API-SVC-03` 환경별 설정·배포·rollback 절차
- [ ] `API-SVC-04` 접근성·반응형·브라우저 호환 기본 검증
- [ ] `API-SVC-05` 시연용 fixture reset과 안전한 demo mode

#### 최종 Exit Gate

- 외부 소비자 contract suite가 모두 PASS합니다.
- build, lint, unit, integration, E2E가 모두 PASS합니다.
- OpenAPI breaking change가 없거나 새 major version으로 승인됐습니다.
- tenant 격리·권한·RAG 품질·성능 SLO를 충족합니다.
- dependency High가 0건이거나 위험 수용 문서가 승인됐습니다.
- migration 배포·rollback 리허설과 운영 runbook이 준비됐습니다.
- 서비스 데모가 내부 endpoint나 관리자 credential에 의존하지 않고 `/v1` 계약으로 동작합니다.
- 고객응대 대표 여정이 staging smoke에서 PASS하고 재현 가능한 초기 상태로 복구됩니다.

### 단계 7 — 매출 자료 분석 서비스 확장

목표: 고객응대 MVP와 공통 API가 안정된 뒤, 정형 매출 데이터를 정확하게 집계하고 AI가 그 결과를 설명하는 두 번째 서비스 여정을 제공합니다. LLM이 원본 매출을 직접 합산하거나 임의의 수치를 생성하지 않도록 계산과 설명 책임을 분리합니다.

#### 검증 데모

- [ ] `SAL-DEM-01` CSV/XLSX 매출 schema·필수 열·자료형·기간 검증 dataset
- [ ] `SAL-DEM-02` 매장·상품·기간별 기대 합계와 증감률 golden result
- [ ] `SAL-DEM-03` 중복 행·누락 값·잘못된 날짜·통화·대용량 파일 경계 시나리오
- [ ] `SAL-DEM-04` tenant별 원본·집계·분석 결과 격리 검증
- [ ] `SAL-DEM-05` AI 설명의 수치 일치·근거 집계 참조·금지 추론 평가

#### AI Server

- [ ] `SAL-SRV-01` 매출 dataset 등록과 schema validation 계약
- [ ] `SAL-SRV-02` 결정론적 매장·상품·기간 집계 API
- [ ] `SAL-SRV-03` 집계 결과와 근거 행을 참조하는 AI 설명 API
- [ ] `SAL-SRV-04` 대용량 파일 비동기 처리와 분석 job 상태
- [ ] `SAL-SRV-05` dataset·집계 결과·분석 리포트 tenant/RBAC 정책
- [ ] `SAL-SRV-06` 집계 version, 원본 checksum과 재현 가능한 분석 이력

#### 서비스 데모

- [ ] `SAL-SVC-01` CSV/XLSX 업로드와 schema 오류 수정 안내
- [ ] `SAL-SVC-02` 기간·매장·상품별 KPI와 비교 차트
- [ ] `SAL-SVC-03` “지난주보다 감소한 상품” 등 자연어 분석 질문
- [ ] `SAL-SVC-04` AI 설명과 계산 근거·필터·원본 범위 표시
- [ ] `SAL-SVC-05` 분석 리포트 저장·재실행·내보내기

#### Exit Gate

- 모든 표시 수치가 결정론적 집계 결과와 일치합니다.
- AI 설명에 포함된 수치가 승인된 집계 결과에 존재하며 임의 계산은 0건입니다.
- 잘못된 입력은 분석 전에 명확한 field 오류로 거절됩니다.
- tenant 교차 매출 원본·집계·리포트 노출은 0건입니다.
- 동일 원본과 version으로 같은 집계 결과를 재현할 수 있습니다.

## 6. 우선순위와 의존관계

| 순서 | 작업 묶음                        | 선행 조건                      | 상대 작업량 |
| ---: | -------------------------------- | ------------------------------ | ----------- |
|    1 | 품질 기준선·CI·migration         | 없음                           | S           |
|    2 | 관리자 인증·tenant 격리          | 기준 환경                      | M           |
|    3 | 지식 생명주기·파일 안전성        | 인증 경계                      | M           |
|    4 | 마트 고객응대 MVP                | 정상 지식 흐름과 source 계약   | M           |
|    5 | 비동기 인덱싱·복원력             | 지식 흐름 안정                 | L           |
|    6 | RAG 품질 dataset과 상담원 피드백 | 재현 fixture와 고객응대 MVP    | M           |
|    7 | 성능·quota·관측성                | 안정적 기능과 metric           | L           |
|    8 | `/v1` 계약·배포 게이트           | 이전 Exit Gate                 | M           |
|    9 | 매출 자료 분석                   | 고객응대 MVP와 `/v1` 계약 안정 | L           |

보안과 tenant 격리가 완료되기 전 외부 앱 대상 성능 결과를 최종 SLO로 확정하지 않습니다. 기능·권한 구조가 바뀌면 성능 기준선도 다시 측정해야 하기 때문입니다.

고객응대와 매출 분석을 동시에 시작하지 않습니다. 고객응대는 현재 지식·RAG 기능을 검증하는 첫 소비자이며, 매출 분석은 결정론적 집계 API라는 별도 기반이 필요하므로 단계 6의 외부 계약이 안정된 뒤 착수합니다.

단계별 권장 작업 비중은 다음과 같습니다.

| 구간     | AI Server | 검증 데모 | 서비스 데모 |
| -------- | --------: | --------: | ----------: |
| 단계 0~2 |       50% |       35% |         15% |
| 단계 3~4 |       45% |       30% |         25% |
| 단계 5~6 |       40% |       35% |         25% |
| 단계 7   |       40% |       30% |         30% |

## 7. 추적성 매트릭스

각 서버 변경 PR 또는 commit에는 다음 내용을 기록합니다.

| 항목               | 필수 내용                                       |
| ------------------ | ----------------------------------------------- |
| 문제 ID            | 예: `SEC-SRV-01`                                |
| 재현 시나리오      | 예: `SEC-DEM-01`                                |
| 서비스 사용자 여정 | persona, 시작 조건, 사용자 동작, 기대 화면 상태 |
| 변경 API/DB        | endpoint, DTO, migration                        |
| 호환성             | additive, breaking, internal                    |
| 검증 증거          | unit/integration/contract report                |
| 성능 영향          | 이전/이후 p95, token, memory                    |
| 운영 영향          | env, IAM, migration, alert, rollback            |

## 8. 완료 정의

개별 작업은 코드 작성만으로 완료하지 않습니다. 다음 조건을 모두 만족해야 `[x]`로 변경합니다.

- 구현과 review 완료
- 관련 단위·통합 시험 PASS
- 검증 데모 재현 시나리오 PASS
- 서비스 데모에 영향이 있으면 대표 사용자 여정 smoke PASS
- OpenAPI 및 관련 문서 갱신
- migration·환경변수·IAM 영향 기록
- 보안 또는 성능 회귀 없음
- 실행 리포트 또는 CI 링크 확보

## 9. 문서 관계

- 본 문서: 전체 실행 순서와 단계별 승인 기준
- [운영 인프라 현행 구성](OPERATIONS_INFRASTRUCTURE_AS_IS.md): 공개 경로, Compose, AWS 종속성과 구성 드리프트
- [AI Server 실서비스 고도화 계획](AI_SERVER_HARDENING_PLAN.md): 보안·운영 개선 항목 요약
- [외부 앱 공통 API 명세 초안](COMMON_API_SPEC_DRAFT.md): 목표 API 경계와 호환 정책
- [기능·품질·성능 검증 전략](TEST_AND_PERFORMANCE_STRATEGY.md): 시험 방법과 지표
- [`demo/docs/DEMO_PLAN.md`](../demo/docs/DEMO_PLAN.md): 데모 구조와 기능 계획
- [`demo/docs/VALIDATION_MATRIX.md`](../demo/docs/VALIDATION_MATRIX.md): 기능별 검증 현황
- [서비스 데모 개발 계획](SERVICE_DEMO_PLAN.md): 고객응대 MVP와 매출 분석 확장의 화면·기능 경계

## 10. 바로 시작할 작업

1. `QLT-SRV-01`: production dependency High 정리와 위험 수용 기준 확정
2. `QLT-DEM-01`: build·typecheck·lint·unit·demo test CI 게이트 연결
3. `ENV-SVC-01~04`: 서비스 데모 골격, persona, fixture와 공통 API client 구성
4. `KNW-DEM-02~05`와 `KNW-SRV-01~06`: 지식 생명주기와 파일 안전성 완성
5. `KNW-SVC-01~05`: 마트 고객응대 MVP 연결
6. `API-SRV-01~03`: 외부 `/v1` 답변 계약과 표준 오류 확정
7. `REL-SRV-01` 및 `REL-DEM-01`: 인덱싱 job 상태 계약 착수

다중 형식 정상 fixture 검증은 확보됐습니다. 다음 작업은 품질 게이트를 먼저 정상화한 뒤 지식 생명주기·악성 파일 안전성을 완성하고, 같은 계약으로 마트 고객응대 MVP를 얇게 연결하는 것입니다. 서비스 데모 화면 확장이 검증되지 않은 내부 endpoint를 앞서가지 않도록 합니다.
