# AI Server·검증 데모·서비스 데모 통합 로드맵

최초 작성일: 2026-08-05
개정일: 2026-09-05
상태: **실행 추적·소켓 장애·실제 AWS 연결 복구·인덱스 COMMIT 응답 유실 검증 완료 — 장기 분할·운영 배포·독립 검수는 별도**
적용 범위: `src/`, `prisma/`, `demo/`, `service-demo/`, 배포 및 운영 설정

## 1. 목적

AI Server를 공통 제품 기반으로, 검증 데모를 실행 가능한 품질 계약으로, 서비스 데모를 실제 사용자 여정과 요구사항을 확인하는 소비자 애플리케이션으로 발전시킵니다. 모든 서버 개선은 대응하는 자동 검증 증거를 가져야 하며, 서비스 데모는 검증을 통과한 안정 계약만 사용합니다. 최종적으로 외부 앱이 사용할 `/v1` 공통 API 명세와 운영 승인 기준을 확정합니다.

세 영역의 역할은 다음과 같이 구분합니다.

| 영역                        | 역할                                                          | 완료의 의미                                                 |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| AI Server                   | 인증, tenant, 지식, RAG, 파일, 운영 계약을 제공하는 제품 기반 | 공개 계약과 SLO를 만족하고 운영 가능한 상태                 |
| 검증 데모 `demo/`           | 계약·보안·품질·성능 회귀를 자동 판정하는 검증 도구            | 변경마다 반복 실행되고 승인 증거를 생성하는 상태            |
| 서비스 데모 `service-demo/` | 마트 고객응대와 이후 매출 분석의 실제 사용자 경험             | 검증된 API로 대표 업무 여정이 처음부터 끝까지 동작하는 상태 |

## 현재 위치 요약

> **2026-09-10 Family RAG 후속:** Family 지식 이벤트 수신, durable 색인,
> tenant 범위 pgvector 검색과 `frame-family-rag-v1` 대화 결합을 구현했다. 빈 격리
> PostgreSQL에 migration 16개를 적용하고 이벤트 → 색인 → 검색 → 대화, retry 및
> 대화 중 삭제 시 근거 재검증을 통과했다. 실제 Bedrock provider, 운영 migration과
> ZINFrame 교차 프로젝트 수용 시험은 남아 있다.
> [통합 검증 기록](FAMILY_RAG_INTEGRATION_VALIDATION_2026-09-10.md).

> **2026-09-06 운영 배포 완료:** AI 서버·검증 데모는 EC2 11000/11001, 서비스 데모는 기존 비공개 Sites에 배포했습니다. migration 13개 적용, 실제 서비스 답변·출처·근거 부족 및 업로드·비동기 색인·매장 격리·보관 검증 PASS. [운영 배포 기록](PRODUCTION_DEPLOYMENT_2026-09-06.md). 아래 9월 5일 수치는 과거 이력이며 장기 부하·독립 검수·정식 운영 승인은 별도입니다.

> **현재: 단계 3 잔여 검증과 단계 4 RAG 품질·안전성 병행**
>
> 최신 RAG 측정 구현: 검색/생성 시간과 실효 maxTokens를 응답·실행 로그에 추가하고 데모 p95·입출력 토큰·측정 건수와 연결했습니다. 미지원/실패 응답의 누락값은 0 대신 미측정으로 표시합니다. [단계별 측정](RAG_PERFORMANCE_TELEMETRY_2026-09-05.md). 실제 AWS 지연 기준선은 별도입니다.
>
> 최신 컴파일 실행: 같은 390초/5분 lease 시험에서 4,021작업 완료, lease 만료 후 465ms에 종료 작업 회수. 장기 실행 PID의 표본 최대 RSS 317~321MiB로 이전 ts-node 845~866MiB보다 낮았습니다. [컴파일 비교](COMPILED_SOAK_2026-09-05.md). 단일 실행·합성 adapter의 비교이며 운영 capacity/메모리 누수 판정은 별도입니다.
>
> 최신 별도 프로세스 검증: 워커 3개·390초 공급·3,986작업 완료. 처리 중 한 워커 강제 종료/재시작 후 실제 5분 lease 만료 402ms 뒤 attempt 2 완료, 대기 중 다른 작업 3,051개 완료. [프로세스 지속 시험](MULTIPROCESS_SOAK_2026-09-05.md). 서비스 경계 합성 의존성·ts-node 실행이며 운영 컴파일 빌드/다중 호스트/수시간 안정성은 별도입니다.
>
> 최신 반복 부하 검증: 약 43KB × 12파일·192청크, 워커 3개에서 정상/단절 각 3회 총 6/6 PASS. 정상 완료 중앙값 4.430초, 연결 복구 후 4.487초, 중복 없음. CPU·RSS·heap·DB 연결 표본을 기록했습니다. [여러 청크 반복 측정](EXTENDED_NETWORK_LOAD_2026-09-05.md). 운영 장시간·다중 프로세스 성능 판정은 별도입니다.
>
> 최신 로컬 부하 검증: 24개 파일 × 워커 1/3개 × 정상/DB 단절의 4개 조건 PASS. 워커 3개에서 정상 0.700초, 연결 복구 후 0.792초에 24개 완료·중복 청크 없음. [부하 측정](NETWORK_LOAD_2026-09-05.md). 합성 외부 응답·단일 실행이며 운영 처리량/SLO 판정은 아닙니다.
>
> 최신 비대칭 단절 검증: 이전 워커만 DB 연결 차단, 정상 워커의 lease 회수/attempt 2 완료 후 이전 워커의 늦은 성공·오류가 최신 청크·파일·작업 상태를 바꾸지 못함을 확인했습니다. 네트워크 15/15 PASS. [비대칭 단절 검증](ASYMMETRIC_PARTITION_2026-09-05.md). 아래 기록은 각 실행 시점의 이력입니다.
>
> 최신 동시 복구 검증: 별도 DB pool의 워커 3개, 테스트 lease 3회 이상 단절 후 단일 attempt 회수 및 반복 단절 시 시도 상한 준수. 네트워크 13/13 PASS. [다중 워커 단절 복구](MULTI_WORKER_PARTITION_2026-09-05.md). 운영 시간 기준 장시간·다중 호스트 부하와 비대칭 분할은 별도입니다.
>
> 최신 DB 검증: 인덱스 COMMIT 응답을 실제로 차단한 뒤 직접 DB 연결에서 저장 성공 확인. lease 만료 후 같은 job attempt 2 완료 및 중복 청크 없음. 네트워크 11/11 PASS. [COMMIT 응답 유실](DB_COMMIT_RESPONSE_LOSS_2026-09-05.md). 아래 수치는 각 실행 시점의 이력입니다.
>
> 최신 후속: 실제 AWS TLS 경로의 S3 단절·Bedrock 지연 복구 2/2 PASS. 동일 job attempt 2 완료, 기존 청크 보존, 테스트 객체 버전/삭제 마커와 임시 DB 정리 완료. [실제 AWS 연결 복구](LIVE_AWS_CONNECTION_RECOVERY_2026-09-05.md). AWS 서비스 내부 429/5xx·COMMIT 응답 유실·장기 분할은 별도 검증입니다.
>
> 2026-09-05 후속: HTTP/2 연결 종료·S3 스트림 중단이 영구 실패로 분류되는 결함 수정. 실제 소켓/SDK·격리 DB 네트워크 시나리오 10개, 서버 단위 197개·검증 데모 37개 PASS. 로그인 갱신 후 실제 AWS NoSuchKey/ValidationException 영구 오류 probe 2/2 PASS. [소켓 장애 검증](NETWORK_RECOVERY_2026-09-05.md) 참조. 실제 AWS 일시 장애 복구 완료를 의미하지 않습니다.
>
> 2026-09-05: 요청 설정·색인 snapshot·빌드 식별 정보의 영속 기록과 평가 실행 ID 연결을 구현했습니다. 서버 186개·검증 데모 37개·격리 통합 24개 통과. [실행·색인 추적](EXECUTION_PROVENANCE_2026-09-05.md) 참조. 아래 과거 평가 실행 수치는 해당 실행의 이력입니다.
>
> DB 기반 job·retry·lease·종료 복구와 실제 AWS 생명주기 기반을 검증했습니다. CSV/Markdown 파싱 및 RAG 답변 계약을 개선하고 golden 50, 확장 70, 간접 공격 56, 반복 74회 평가를 수행했습니다. **실제 AWS 일시 장애 복구·독립 검수·운영 승인은 남아 있습니다.** 로컬 검증/소스 푸시는 원격 운영 배포 완료를 의미하지 않습니다. [구현·검증 인수인계](IMPLEMENTATION_AND_VALIDATION_2026-09-04.md) 참조.

| 단계 | 주제 | 현재 판정 | 핵심 상태 |
| ---: | --- | --- | --- |
| 0 | 재현 가능한 기준 환경 | 대부분 완료 | fixture, readiness, 서비스 데모 실행 기반 확보; migration 복구 리허설·dependency 잔여 |
| 1 | 인증·권한·tenant 경계 | 현재 데모 역할 범위 완료 | BFF credential 비노출, STORE_A/B 격리, 역할별 메뉴·서버 권한 검증 완료 |
| 2 | 지식 생명주기·파일 안전성 | 완료 | 고객·관리자·역할 경계와 정책 matrix 17/17 완료 |
| **3** | **비동기 인덱싱·장애 복원력** | **진행 중** | 실제 AWS 연결 복구·인덱스 COMMIT 응답 유실 검증; 서비스 내부 장애·장기 분할 남음 |
| 4 | RAG 품질·안전성 | 개발 평가·실행 추적 구현 | 파서·응답 계약·3유형 반복 및 설정/색인 snapshot 완료; 독립 자료·검수·운영 피드백 남음 |
| 5 | 쿼터·성능·비용 | 로컬 반복 부하·자원 기준 확보 | 작은 문서 4조건 및 192청크 정상/단절 6회·프로세스 자원·DB 연결 측정; 운영 SLO·장시간·비용은 별도 |
| 6 | `/v1` 공통 API·배포 게이트 | 일부 기반만 진행 | 관리자 API 일부 완료; 외부 계약·OpenAPI·배포 승인 남음 |
| 7 | 매출 자료 분석 확장 | 예정 | 고객응대 MVP와 `/v1` 안정 후 착수 |

현재 단계의 작업 흐름은 다음과 같습니다.

```text
[완료] 고객 질문·근거·no-answer·tenant 전환
  → [완료] 매장 관리자 업로드·새 버전 등록·기존 버전 보관 화면 승인
  → [완료] 역할별 메뉴·서버 권한과 개인정보·credential 비노출
  → [완료] 게시 상태·기간·상품코드·접근등급 정책 matrix 자동화
  → [완료] 비동기 인덱싱 상태·수동 재시도·중복 방지 기본 계약
  → [완료] retryable 오류 분류·선별 자동 재시도·embedding 동시성 제한
  → [완료] AWS timeout·HTTP disconnect abort·shutdown 중 작업 상태 보존
  → [현재] 실제 외부 의존성 장애 호출·부분 실패 운영 검증
  → [후속] RAG 품질·성능·외부 /v1 계약
  → [최종 확장] 매출 자료 분석
```

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

| 항목                  | 현재 상태                                         | 목표                                   |
| --------------------- | ------------------------------------------------- | -------------------------------------- |
| AI Server build       | PASS                                              | 계속 PASS                              |
| 단위 테스트           | 197/197 PASS (2026-09-05)                          | 핵심 서비스 branch 80% 이상            |
| 검증 데모 자체 테스트 | 37/37 PASS (2026-09-05)                            | 시나리오·fixture 변경마다 계속 PASS    |
| CI 품질 게이트        | 로컬·GitHub PASS, `main` PR 필수 체크 적용        | 계속 PASS 및 audit artifact 보존       |
| E2E                   | 격리 DB 통합 39/39 PASS (2026-09-05, 네트워크 15개 포함), 고객응대 대표 여정은 이전 검증 | 외부·관리·지식 생명주기 전체 자동 실행 |
| line coverage         | 이전 측정 30.34%, 이번 작업 미측정                 | 핵심 서비스 80% 이상                   |
| typecheck             | PASS                                              | 계속 PASS                              |
| lint                  | PASS                                              | 계속 PASS                              |
| dependency audit      | 이전 측정 High 4, Moderate 0; 현재 수치 재측정 필요 | High 0 또는 승인 예외                  |
| DB migration          | 격리 신규 DB 13개 migration·pgvector·E2E PASS; 서비스 DB 미적용 | 배포 환경과 schema 일치                |
| 검증 데모             | 핵심 계약·보안·parser 검증과 제한 성능 러너       | 전체 자동 검증 및 승인 리포트          |
| 서비스 데모           | 고객 채팅·관리자 업로드·정책·색인 상태/복구 화면 구현, 9/4 테스트 56개 PASS | 마트 고객응대 MVP 후 매출 분석 확장    |
| 외부 API              | 기존 내부 endpoint 혼재                           | `/v1` 안정 계약 확정                   |
| 관리자 API            | API key 기반 관리자·지식 운영자 RBAC 적용         | identity 기반 인증과 감사 보존 정책    |
| 관측성                | correlation ID와 DB log 일부                      | 로그·metric·trace·alert 연결           |

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
- [x] `QLT-DEM-01` workflow·로컬·GitHub 실행 PASS 및 `main` PR 필수 체크 지정

#### AI Server

- [x] `ENV-SRV-01` 미적용 migration preflight 및 적용
- [~] `ENV-SRV-02` migration 중복 appcode 확인 완료, 중복 데이터 복구 리허설 예정
- [x] `ENV-SRV-03` startup 필수 환경변수 validation
- [x] `ENV-SRV-04` live/readiness endpoint 분리
- [~] `QLT-SRV-01` typecheck·lint 오류 0건, dependency High 9→3 완료; Prisma CLI 전이 위험 처리 예정

#### 서비스 데모

- [x] `ENV-SVC-01` `service-demo/` 독립 애플리케이션 골격과 실행 설정
  - 로컬·운영 공통 포트 11002와 포트 검증 설정 선반영
- [x] `ENV-SVC-02` 마트 고객·상담원·매장 관리자 persona와 대표 사용자 여정 정의
- [x] `ENV-SVC-03` 실제 개인정보가 없는 상품·정책·문의 fixture와 화면 상태 정의
- [x] `ENV-SVC-04` API client, correlation ID, 오류 표시의 공통 계층 구성
  - 검증 기록: `docs/SERVICE_DEMO_VALIDATION_REPORT_2026-08-30.md`

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

- [x] `SEC-SVC-01` 브라우저에 관리자·지식 운영자 credential을 노출하지 않는 BFF 경계
- [x] `SEC-SVC-02` STORE_A/STORE_B tenant context 전환과 교차 데이터 비노출 화면 검증
- [x] `SEC-SVC-03` 고객·상담원·매장 관리자별 메뉴와 동작 권한 분리
  - 고객 채팅, 상담원 검토함, 관리자 지식관리 경로를 분리하고 상담원·관리자별 이메일 allowlist와 별도 HttpOnly 로컬 세션을 서버에서 판정
  - 영구 상담원 검토 요청 저장과 피드백 처리는 단계 3 `REL-SVC-01` 범위로 연결
- [x] `SEC-SVC-04` 로그·화면·오류 메시지의 credential 및 개인정보 비노출
  - appkey·운영자 키·로컬 세션 토큰·내부 source metadata 비노출 자동 검증과 4개 화면 응답 secret 0건 확인
  - 상담원 권한 응답에서 이메일 비노출, 대표 개인정보의 AI Server 전송 전 차단·원문 비반사 확인
  - 서비스 데모 자체 영구 저장 0일과 request body·cookie 비기록 정책 문서화

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
- [x] `KNW-DEM-02` upload → index → policy → search → answer 자동 흐름
- [x] `KNW-DEM-03` reindex, archive, S3 삭제와 중복 실행 시나리오
  - 실제 HTTP 생명주기를 10단계로 확장해 reindex 2회 chunk 수·검색 정책 유지 검증
  - cleanup 2회에서 동일 `archivedAt`, chunk 0, S3 cleanup `completed` 유지 검증 10/10 완료
- [x] `KNW-DEM-04` 확장자 위장·빈 문서·손상 문서·대용량 문서 시나리오
  - 실제 multipart HTTP에서 위장·빈·손상 파일 400, 대용량 파일 413 및 구조화 오류·correlation 계약 7/7 검증
- [x] `KNW-DEM-05` DRAFT/PUBLISHED/RETIRED, 기간, productCode, accessLevel matrix
  - 실제 HTTP 정책 변경·검색·자동 정리 17/17 PASS, PostgreSQL vector 경로에서 파일 ID 포함·제외 확인

#### AI Server

- [x] `KNW-SRV-01` Multer 수신 단계 file/field/part size 제한
- [x] `KNW-SRV-02` MIME signature와 확장자 교차 검증
- [x] `KNW-SRV-03` S3 업로드·다운로드 streaming 전환
  - multipart 임시 파일 staging, S3 multipart upload, HTTP download pipeline과 parser용 bounded-buffer 경로 분리
  - 29MiB 실제 S3 smoke에서 upload/download SHA-256 일치, S3·임시 파일 정리, AI Server RSS 증가 0.13MiB 확인
- [x] `KNW-SRV-04` upload와 DB record 실패 보상 처리
  - S3 upload 성공 후 DB record 생성 실패 시 tenant key를 보상 삭제하고 원래 DB 오류를 유지
  - S3 upload 실패·DB 성공 시에는 삭제하지 않으며, DB와 보상 삭제가 모두 실패하면 orphan 위험을 구분하는 오류 코드 반환
  - fault-injection 단위 테스트 4/4와 실제 S3 전체 생명주기 6/6, streaming smoke 재검증 완료
- [x] `KNW-SRV-05` archive·chunk 삭제·S3 삭제 일관성 개선
  - DB transaction에서 file archive와 chunk 삭제를 원자적으로 확정하고 S3 정리 필요 상태를 기록
  - S3 삭제 성공 시 정리 완료를 확정하며, 실패 시 archived 상태와 재시도 가능한 cleanup 실패 정보를 보존
  - 동일 요청 재실행을 안전하게 만들고 DB transaction·S3 삭제·완료 기록 실패 경로를 fault-injection으로 검증
  - fault-injection·멱등 재시도 6/6, 실제 S3 전체 생명주기 6/6과 streaming smoke 재검증 완료
- [x] `KNW-SRV-06` 취약한 XLS/XLSX parser 교체 또는 격리
  - 취약한 `xlsx` 0.18.5를 제거하고 유지보수 중인 `read-excel-file` 9.3.10으로 XLSX parser 교체
  - legacy XLS 허용 제거, 30MB file·50 sheet·sheet당 50,000 row·row당 512 column·전체 200,000 cell·cell 문자열 32,767자 상한 적용
  - parser 단위 계약 10/10, 실제 PDF·DOCX·XLSX metadata·검색 회귀 6/6과 전체 생명주기 6/6 완료

#### 서비스 데모 — 마트 고객응대 MVP

- [x] `KNW-SVC-01` 고객 채팅, 추천 질문과 대화 상태 화면
  - 실제 `/knowledge/answers` BFF와 로컬 AI Server/appkey 연결 E2E 완료
- [x] `KNW-SVC-02` 답변 근거 문서·페이지·상품·정책 출처 표시
  - source allowlist, 내부 S3 key·content·metadata 비노출과 실제 fixture source 대조 완료
- [~] `KNW-SVC-03` strict no-answer와 상담원 연결·검토 요청 흐름
  - strict 요청·source 없는 답변 차단·세션 검토 요청 구현 완료, 영구 검토함 연동 예정
- [x] `KNW-SVC-04` 매장 관리자 문서 업로드·게시 상태·오류 확인 화면
  - 목록·업로드·고객 공개 정책·인덱싱·재인덱싱·보관 구현, 실제 API E2E와 사용자 화면 승인 완료
- [x] `KNW-SVC-05` 환불·교환·운영시간·상품 문의 end-to-end 대표 시나리오
  - STORE_A/STORE_B 실제 fixture, 짧은 정책 질문, strict no-answer와 tenant source 격리 확인

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

- [~] `REL-DEM-01` 인덱싱 job 제출·조회·완료 scenario와 서비스 실패·재시도 화면 완료; 강제 실패·재시도 scenario 남음
- [~] `REL-DEM-02` Bedrock 429, timeout, 5xx 단위 및 로컬 HTTP/2·실제 SDK E2E, 실제 AWS TLS 경로 지연/복구 완료. AWS 서비스 내부 429/5xx 시험은 별도
- [~] `REL-DEM-03` S3 없음·DB 일시 오류를 서비스 경계에 주입하고 로컬 PostgreSQL 상태 전이 검증 완료; 실제 AWS 장애 호출 E2E 남음
  - 2026-09-04 추가: `npm run test:aws-live-lifecycle` PASS. 실제 S3 원본 삭제 후 HTTP reindex job이 `INDEX_SOURCE_NOT_FOUND`, attempt 1, retryable false로 종료하고 기존 vector·검색을 보존함. 실제 AWS 일시 장애 복구/DB 네트워크 장애는 여전히 미검증.
  - 로컬 전용 opt-in E2E 7/7 PASS: 429·timeout 복구, 5xx 재시도 소진, Validation·AccessDenied·NoSuchKey 영구 실패, Prisma transaction 일시 오류 복구
  - 2026-09-05 추가: 소켓/SDK 네트워크 E2E 10/10 PASS. 실제 PostgreSQL 워커 연결 종료·신규 연결 차단 후 lease 자연 만료/재처리 확인. S3 스트림·Bedrock HTTP/2 연결 중단의 영구 실패 오분류 수정. 로컬 응답 합성이며 실제 AWS·COMMIT 응답 유실·장기 분할 검증은 별도.
  - 재시도 대기와 영구 실패 중 기존 chunk 보존, 성공 transaction에서만 chunk 교체, fixture 자동 정리 확인
- [x] `REL-DEM-04` 동일 요청 중복 제출과 idempotency 검증
- [x] `REL-DEM-05` 오류 code, retryable과 next attempt 계약 단위·BFF 검증

#### AI Server

- [x] `REL-SRV-01` 인덱싱을 DB queue 기반 비동기 job으로 전환
- [x] `REL-SRV-02` chunk embedding 동시성 제한
- [x] `REL-SRV-03` retryable 오류만 SDK adaptive retry와 durable job backoff 적용
- [x] `REL-SRV-04` 요청 timeout, abort 전파와 graceful shutdown
  - Bedrock control/runtime·embedding·S3 client에 adaptive retry, 연결 5초·전체 작업 30초 기본 timeout 적용
  - HTTP client disconnect를 AWS SDK abortSignal로 전파하고 S3 parser stream과 multipart upload도 취소
  - SIGINT/SIGTERM shutdown hook에서 진행 중 AWS 호출을 취소하고 인덱싱 job의 retry 상태 기록 완료까지 대기
- [x] `REL-SRV-05` idempotency key와 중복 active job 제어
- [x] `REL-SRV-06` 수동 복구 가능한 failed 상태와 최대 재시도 횟수

#### 서비스 데모

- [x] `REL-SVC-01` 파일 업로드·인덱싱 job 진행·완료·실패 상태 표시
- [x] `REL-SVC-02` 재시도 횟수가 남은 failed job에만 재시도 동작 제공
- [x] `REL-SVC-03` idempotency key 기반 중복 제출 방지와 사용자 재클릭 안전성
- [x] `REL-SVC-04` 일시 장애·영구 실패·재시도 소진 안내와 correlation ID 표시, 조회 timeout 후 동일 job 상태 확인 재개 검증 완료
  - 2026-09-04 Playwright 브라우저 6개 시나리오 통과: 504 복구, 영구 실패, 재시도 소진, 허용된 재시도, backoff 대기, 실제 브라우저 10초 조회 deadline. 합성 BFF 응답을 사용하며 AWS 장애 재현이나 배포 검증을 의미하지 않음.

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

- [x] `RAG-DEM-01` 최소 50개 golden question dataset
  - 2026-09-04 `demo/fixtures/rag-golden.json` v1.0.0: 정책/상품 30, 미등록 정보 10, 공격/개인정보/격리 10. 답변 가능 35, 불가 15. 텍스트 fixture 3개와 근거 문장/행 검증 완료.
- [~] `RAG-DEM-02` 채점기·회귀 테스트와 실제 50문항 기준선 수집 완료; 2026-09-04 출처 5/35, no-answer 15/15, case 20/50으로 gate FAIL. 검색 누락·매장 별칭·채점 오탐 개선 필요 (`demo/docs/RAG_BASELINE_2026-09-04.md`)
  - 1차 개선 비교: CSV 행별 파싱 + 별칭 corpus v2 + 채점기 v2. case 44/50, 출처 34/35로 개선. no-answer 11/15 및 금지 문자열 재인용 1건으로 gate는 여전히 FAIL. `demo/docs/RAG_IMPROVEMENT_2026-09-04.md` 참조.
  - 2차 개선 비교: 구조화된 답변 가능 판단 + 출처/완료 상태 검증. case 49/50, no-answer 15/15, critical/금지 문자열 0건. A10 검색 누락으로 gate FAIL 유지. `demo/docs/RAG_ANSWERABILITY_2026-09-04.md` 참조.
  - 3차 개선: Markdown 절 단위 파싱으로 A10 검색 누락 해결. case 50/50, 출처 35/35, no-answer 15/15, gate PASS(개발 표본 단일 실행). 미관측 질문·반복 평가·사람 검토는 남음. `demo/docs/RAG_RETRIEVAL_2026-09-04.md` 참조.
  - 확장 평가: 신규 개발용 20문항 + 기존 50문항을 고정해 70/70, 출처 47/47, no-answer 23/23, gate PASS. 출력 실패를 거절하는 채점기 v3 적용. 독립 holdout·간접 injection·반복/사람 검수는 남음. `demo/docs/RAG_EXPANSION_2026-09-04.md` 참조.
- [~] `RAG-DEM-03` strict no-answer 실제 15/15 측정 완료; supplemental source 확장 남음
- [~] `RAG-DEM-04` 직접 공격 10문항 및 별도 문서 내부 지시/조건·예외 6문항 실제 검증. 기존 50 + 신규 6 = 56/56 PASS, 인용 청크 공격 노출 확인 및 생성 표식 0건. 공격 유형 확장·반복 검증은 남음 (`demo/docs/RAG_ADVERSARIAL_2026-09-04.md`)
  - 3유형(권한 사칭/JSON 훼손/작업 전환) 및 집중 8문항 3회 반복 완료. 기준선 50 + 반복 24 = 74/74 PASS, 판정 변동 0, 문구 변동 3문항·출처 집합 변동 1문항. 드문 실패/독립 환경·검수는 남음 (`demo/docs/RAG_REPEATABILITY_2026-09-04.md`).
- [~] `RAG-DEM-05` 1~3차 parser/prompt 비교 보고서 및 baseline 50 / expansion 20 분리 집계 구현. 모델별·반복 실험은 남음

#### AI Server

- [x] `RAG-SRV-01` promptVersion, 실효 모델/검색/생성 설정, source/index snapshot, 코드 revision/소스 해시 영속 기록 및 평가 실행 ID 연결. 2026-09-05 로컬 검증 완료. 과거 인덱스는 null 유지, 배포·재색인 별도. [상세](EXECUTION_PROVENANCE_2026-09-05.md)
- [~] `RAG-SRV-02` 참고자료 내부 지시 무시 규칙과 출력 계약 구현·간접 공격 개발 평가 완료. 구조적 분리 강화 및 독립 검수는 남음
- [~] `RAG-SRV-03` 모델의 구조화된 답변 가능 판단과 출처 검증으로 answerable 분리. 검색 score 보정은 남음
- [~] `RAG-SRV-04` CSV 행별 파싱 및 Markdown 제목별 절/상위 제목 보존 적용. 긴 절 문맥·chunk 크기/overlap 비교는 남음
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

- [~] `PERF-DEM-01` RAG 검색·생성 시간을 응답/실행 로그/데모 리포트로 분리 기록 완료; 실제 AWS 기준선 수집 별도
- [~] `PERF-DEM-02` input/output/total과 요청 maxTokens·RAG 서버 실효 maxTokens 및 측정 건수 기록 완료; 기타 AI endpoint 실효 설정 추적 별도
- [x] `PERF-DEM-03` Smoke/Baseline/Burst·직접 설정, 기준 실행 지정/JSON 가져오기, 조건 차이·지표 비교 및 JSON 내보내기 구현. [검증](PERFORMANCE_PRESETS_2026-09-05.md)
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
- [지식 파일 업로드 안전성 개선 기록](KNOWLEDGE_UPLOAD_SECURITY_2026-08-19.md): 수신 제한, 형식 검증과 잔여 parser 위험

## 10. 바로 시작할 작업

1. [x] `KNW-SVC-04`: 매장 관리자 지식 목록·업로드·새 버전 등록·기존 버전 보관 화면 승인
2. [x] `SEC-SVC-03~04`: 역할별 메뉴·서버 권한 분리와 개인정보 로그·보존 정책 완료
3. [x] `KNW-DEM-05`: 게시 상태·기간·productCode·accessLevel 정책 matrix 자동화 17/17
4. **`REL-SRV-01`, `REL-DEM-01`, `REL-SVC-01`**: 비동기 인덱싱 job과 진행·완료·실패 상태 계약
5. `API-SRV-01~03`: 외부 `/v1` 답변 계약, 표준 오류와 OpenAPI 확정

품질 게이트, 다중 형식 fixture, 파일 방어선, S3 streaming과 HTTP 지식 생명주기, 고객 채팅·관리자 문서관리 사용자 여정을 확보했습니다. 다음 작업은 고객·상담원·매장 관리자 역할별 메뉴와 서버 권한을 일치시키고 개인정보·credential 비노출 검사를 마무리하는 것입니다.
