# HJ AI Console 구현 진행 현황

작성일: 2026-09-13

최종 갱신일: 2026-09-28

대상 프로젝트: HJ AI Server

기준 계획: [HJ-Works 연계 AI Console 구축 계획](HJ_WORKS_AI_CONSOLE_IMPLEMENTATION_PLAN.md)

현재 단계: **[Console M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 4/5]**

단계 상태·완료 기준·검증 이력의 기준 문서: [전체 마일스톤](HJ_AI_CONSOLE_MILESTONES.md).
M1-01~05 생성 API 연결·요청 중복 제거·예약 복구·경계 정책과 실제 PostgreSQL 검증을 완료했다. 검증 근거는 전체 마일스톤의 작업별 기록, 운영 절차는 [예약 복구 runbook](HJ_AI_CONSOLE_USAGE_RECOVERY_RUNBOOK.md)을 참조한다.

M2-01~05 공통 로그·복구 귀속·월 지표·차원별 집계·CSV 정합성과 격리 PostgreSQL 검증을 완료했다. [사용량·로그 계약](HJ_AI_CONSOLE_USAGE_CONTRACT.md)을 따른다.

## 1. 작업 목표와 구현 순서

HJ-Works 사용자에게 조직 단위 AI 애플리케이션, API credential, 사용량, 지식 자료를
관리하는 셀프서비스 Console을 제공한다. 기능 개발을 먼저 완료하고 HJ-Works 로그인과
세션 통합은 마지막 기능 단계에서 수행하도록 순서를 변경했다.

앱·credential·Playground의 기존 구현을 재사용한다. 2026-09-18 검토 결과를 반영한 잔여
실행 순서는 M1 월 한도 정합성 → M2 사용량·로그 정합성 → M3 통합 검증·CI →
M4 홈·알림·감사 조회 → M5 지식 관리 → M6 HJ-Works 로그인·세션 → M7 운영 공개다.

기능 개발 중에는 실제 인증 방식과 분리된 `ConsoleIdentityContext` fixture를 사용한다.
인증 통합 시 동일한 identity port의 구현체만 Works SSO/session adapter로 교체한다.

## 2. 구현 현황과 재검토 상태

기존 완료 항목은 기록된 구현 범위를 뜻한다. 2026-09-18에 발견한 보완 항목은 다시
열어 두며, 운영 공개 완료 판정은 전체 마일스톤의 M7 기준을 따른다.

| 작업 | 상태 | 구현 내용 |
| --- | --- | --- |
| `CON-WORKS-01` | 완료 | HJ-Works 인증 방식을 조사하고 Firebase 기반 Works 세션과 60초·1회용 서비스 인가 코드 교환 방식 재사용으로 결정 |
| `CON-WORKS-02` | 초안 완료 | 불변 user·organization·membership 계약, TypeScript 계약, fixture와 계약 시험 작성. HJ-Works 공동 승인은 대기 중 |
| `CON-SRV-01` | 완료 | Console organization, identity, membership, app ownership Prisma 모델과 additive migration 작성 |
| `CON-SRV-03` | 완료 | 인증 방식 독립 `ConsoleIdentityContext`, permission decorator·guard, 조직 범위 fail-closed resolver 구현 |
| `CON-SRV-05` | 완료(M4-03) | Console/Works 불변 actor와 session hash 저장, `audit:read` 조직 범위 조회·필터·cursor·안전한 projection 및 저장 실패 정책 |
| `CON-SRV-06` | 완료 | Console 앱 목록·상세·생성·수정 API 구현 |
| `CON-SRV-07` | 완료 | 조직 소유권에 따른 조회 범위 제한, 타 조직 리소스 404 비노출, AppInfo와 ownership 원자적 생성 구현 |
| `CON-SRV-08` | 완료 | API key 일회성 발급·회전·폐기 API와 회전 grace 정책 구현 |
| `CON-SRV-09` | 완료 | credential ID, 발급 actor, 발급·만료·최근 사용 시각 metadata 저장과 조회 구현 |
| `CON-WEB-02` | 완료 | 독립 Console Web/BFF, 앱 검색·상태 필터·생성·상세 수정, 반응형 화면 구현 |
| `CON-WEB-03` | 완료 | credential metadata, 최초 발급·회전·개별 폐기, 원문 key 일회성 표시·복사·저장 확인 UX 구현 |
| `CON-WEB-04` | 완료 | 실제 지식 답변 Playground와 request ID·출처·지연 및 cURL·JavaScript·Python 예제 구현 |
| `CON-SRV-10` | 완료(M2) | 공통 요청 SQL·복구/승인 월/조직 귀속·실패 계측·Family embedding 범위 확정, 실 DB 원본 대조 |
| `CON-SRV-11` | 완료(M2) | 최근 기간과 UTC 월 한도 API 분리, p50/p95·endpoint/model/status별 집계·공통 필터 |
| `CON-SRV-12` | 완료(M2) | Family·복구 목록/상세, Bedrock request ID·실패·endpoint/model/status 필터와 cursor 실 DB 검증 |
| `CON-SRV-13` | 완료(M1) | 예약·정산·복구·경계 정책 및 격리 PostgreSQL 16개, 관련 회귀 254개 통과. 운영 반영은 M7 |
| `CON-SRV-14` | 완료(M4-01/M4-04) | 조직 월 요청·token 70/90/100% unique event와 `usage:read` 조직 범위 내부 알림함·멱등 재조회 연결 |
| `CON-WEB-05` | 완료(M4-02) | 당월 committed·잔여·성공률·p95, 최근 오류·Key 만료와 M5 지식 색인 실패 계약을 갖춘 반응형 홈 |
| `CON-WEB-06` | 완료(M2/M3) | Family/복구/CSV·필터·월/기간 분리·usage→로그 링크와 VM 렌더 검증, M3-03 실제 브라우저 사용량·로그 여정 완료 |

## 3. Console API 현황

기준 경로는 `/console-api/v1`이며 현재 다음 endpoint를 제공한다.

| Method | 경로 | 기능 |
| --- | --- | --- |
| `GET` | `/apps` | 조직 소유 앱 목록 조회 |
| `POST` | `/apps` | 앱과 조직 ownership 생성 |
| `GET` | `/apps/:id` | 조직 소유 앱 상세 조회 |
| `PATCH` | `/apps/:id` | 앱 정보와 상태 수정 |
| `GET` | `/apps/:id/credentials` | credential metadata 목록 조회 |
| `POST` | `/apps/:id/credentials` | 최초 credential 발급과 원문 일회성 반환 |
| `POST` | `/apps/:id/credentials/rotate` | credential 회전과 제한된 grace 적용 |
| `DELETE` | `/apps/:id/credentials/:credentialId` | 지정 credential 폐기 |
| `GET` | `/usage/monthly` | UTC 이번 달 확정·예약·한도·잔여량·사용률 |
| `GET` | `/usage/alerts` | 현재 UTC 월의 조직 범위 읽기 전용 사용량 알림함 |
| `GET` | `/usage/summary` | 요청·token·embedding·성공률·지연 합계 조회 |
| `GET` | `/usage/timeseries` | UTC 일별 사용량 조회 |
| `GET` | `/usage/breakdown` | 조직 귀속 앱·endpoint·model·status별 사용량 조회 |
| `GET` | `/request-logs` | 요청 로그 필터·cursor 목록 조회 |
| `GET` | `/request-logs/:logId` | 원문을 제외한 요청 실행 상세 조회 |
| `GET` | `/request-logs/export.csv` | 최대 5,000행 metadata CSV 내보내기 |
| `GET` | `/audit-events` | 조직 범위 활동·보안 감사 filter·cursor 목록 조회 |

모든 앱·credential 작업은 organization ownership과 permission을 먼저 검사한다. 원문
credential은 발급 또는 회전 응답에서 한 번만 반환하며 저장소와 감사 로그에는 남기지
않는다.

## 4. 데이터베이스 변경

다음 additive migration을 작성했다.

- `20260912090000_add_console_identity_foundation`: 조직, identity, membership, 앱 ownership
- `20260912100000_extend_console_audit_actor`: Console·Works 감사 actor와 session hash
- `20260913100000_add_console_credential_metadata`: credential 식별자, 발급자와 사용 시각 metadata
- `20260917100000_add_console_usage_reservation`: 월 한도 예약·정산·불확실 상태 원장
- `20260918100000_add_usage_reservation_recovery`: 로그 참조·복구 계수·멱등 key와 제약 (격리 PostgreSQL 적용 검증 완료)
- `20260918110000_add_usage_reservation_policy`: operation 범위·0토큰 예약 식별·연결 실측 예약 보정 (격리 PostgreSQL 적용 검증 완료)
- `20260918120000_add_console_request_metadata`: Bedrock·Family 요청 metadata (격리 PostgreSQL 적용 검증 완료)
- `20260923100000_add_console_usage_threshold_event`: 조직 월 요청·token 70/90/100% event와 중복 방지 (격리 PostgreSQL 적용 검증 완료)

마이그레이션 파일과 Prisma schema는 준비됐지만 운영 데이터베이스에는 아직 적용하지
않았다. 이는 기존 기록이며 이번 검토에서 운영 DB를 조회하지 않았다. 운영 적용은
전체 마일스톤 M7(기존 계획 단계 5)의 배포 전 검증과 rollback 절차를 거쳐 수행한다.

## 5. Console Web/BFF 현황

- 기본 포트: `11003`
- 실행: `npm run start:console-web`
- 시험: `npm run test:console-web`
- AI Server의 `/console-api/*`를 같은 origin으로 proxy
- 앱 목록, 검색, 상태 필터, 생성, 상세와 수정 화면 제공
- credential 발급·회전 TTL/grace 설정과 폐기 확인 제공
- 원문 key dialog를 닫으면 DOM에서 제거하며 local/session storage에 저장하지 않음
- 모바일 폭에서 사용할 수 있는 반응형 navigation과 상태 UX 제공
- 실제 지식 답변 Playground와 언어별 빠른 시작 예제 제공
- 요청·token·embedding·성공률·지연 사용량 dashboard 제공
- 요청 로그 필터·상세·CSV 내보내기 제공
- 버전 없는 정적 asset은 `no-cache`로 전달

Console Web/BFF는 현재 Node.js 기본 모듈과 정적 SPA만 사용하며 별도 외부 dependency를
추가하지 않았다.

## 6. 보안과 격리 원칙

- identity 또는 조직 context를 확인할 수 없으면 요청을 허용하지 않는 fail-closed 정책
- 조직 ownership이 없는 리소스는 존재 여부를 노출하지 않고 404 처리
- permission guard를 통한 읽기·쓰기 권한 분리
- 앱·credential 변경을 Works 사용자 ID와 조직, 요청 context를 포함해 감사 기록
- session ID는 원문 대신 hash로 기록
- API key 원문은 서버 저장소, 브라우저 저장소와 감사 로그에 기록하지 않음
- 회전 grace는 기존 credential의 원래 만료 시각을 넘길 수 없음

## 7. 검증 결과

### 7.1 2026-09-18 검토 기준선

직전 소스 검토에서 커밋되지 않은 변경을 포함한 현재 작업본에 실행한 결과다.
이번 마일스톤 문서 작성에서 재실행한 결과는 아니다.

| 검증 | 결과 |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint:check` | Pass |
| `npm run test:ci -- --testPathPatterns='console\|usage-quota\|knowledge.contract\|conversation'` | Pass — 선택 18 suites, 120 tests |
| `npm run test:console-web` | Pass — 21 tests |

실제 DB 동시성, 브라우저 E2E, 운영 DB migration과 HJ-Works 실계정 SSO는 이번 검토에서
미실행이다. 한도 테스트는 mock 직렬화이며 실제 DB 다중 프로세스 보장을 검증하지 않는다.
2026-09-21 M3-01에서 기본 `verify`/CI에 Console Web 검사를 연결했다. 실패 주입 검증도 CI에 추가했다. 아래 과거 검사 기록과 최신 실행 결과는 구분한다.

### 7.2 이전 기록(2026-09-18 재검증 아님)

아래는 이전 진행 문서에 기록된 결과를 보존한 것이다. 실행일·revision이 표에 기록되지
않았으므로 최신 작업본의 전체 검증 결과로 사용하지 않는다.

| 검증 | 결과 |
| --- | --- |
| `npm run build` | Pass |
| `npm run lint:check` | Pass |
| `npm run test:ci` | Pass — 51 suites, 332 tests |
| `npm run test:demo` | Pass — 56 tests |
| `npm run test:console-web` | Pass — 11 tests |
| 브라우저 대표 여정 | Pass — 발급, 복사, 원문 제거, grace 회전, 이전 key 폐기 |
| 브라우저 console | 오류·경고 0건 |
| `git diff --check` | Pass |

운영 데이터베이스 migration 검증과 실계정 SSO 검증은 각각 M7과 M6의 필수 완료 기준이다.

## 8. 남은 작업과 다음 단계

즉시 다음 작업은 **M4-05 임계치·감사·홈 최종 DB·브라우저 회귀 검증**이다.
M4-01~04의 임계치 event·홈·감사 조회·내부 알림함과 상태 UX는 완료했다.

1. M1: 완료. 실제 DB 검증 근거와 제한은 마일스톤 M1-05 기록 참조.
2. M2·M3 완료. M3의 실 DB·브라우저·CI·전체 품질 검사 근거는 마일스톤 기록 참조.
3. M4: 임계치 동시 도달·월 전환, 감사 격리, 홈 모바일·키보드 최종 회귀 잔여.
4. M5: 조직 범위 지식 파일 업로드·색인·재시도·게시·보관.
5. M6: HJ-Works 계약 확정, 로그인·세션·로그아웃 최종 통합.
6. M7: migration rehearsal, 보안·접근성 검수, 관측성·rollback과 단계적 공개.

`CON-WORKS-02`는 코드와 fixture 검증은 끝났지만 HJ-Works 측 공동 승인이 남아 있다.
로그인 통합 단계에 들어가기 전에 해당 계약과 역할·event 계약을 최종 확정해야 한다.


### M2 검증 추가 기록 — 2026-09-18

로컬 작업본 기준 `test:console-usage-db` 8개와 `test:usage-quota-db` 16개(격리 실 PostgreSQL),
관련 서버 24 suites/268개, `test:console-web` 24개, typecheck/lint:check/build 및 Prisma validate Pass.
Web에는 VM markup 렌더 시험이 포함되며 이번 M2 변경의 브라우저·AWS·운영 검증은 미실행이다.
신규 migration `20260918120000_add_console_request_metadata`는 격리 DB에만 적용했다.
전체 상세·제약은 마일스톤 M2-01~05 기록 참조. 과거 브라우저 기록을 이번 변경의 검증으로 사용하지 않는다.


### M3-01 검증 추가 기록 — 2026-09-21

`npm run verify`: Pass (build/typecheck/lint:check, 서버 497개, Console Web 24개, demo 56개).
`npm run test:console-web-gate`: Pass (임시 복사본에서 주입 실패 → verify exit 1, 이후 검사 중단).
CI workflow는 verify와 실패 전파 검사를 실행하도록 연결했다. 신규 의존성은 없다.
Windows/Node 24.15.0/npm 11.12.1, HEAD e3a6bc80에 M2·M3-01 미커밋 변경을 포함한 작업본이다.
원격 GitHub Actions·DB·브라우저 E2E·AWS·배포는 이번 작업에서 미실행. 자세한 근거는 마일스톤 M3-01 참조.

### M3-02 검증 추가 기록 — 2026-09-23

`npm run test:console-access-db`: Pass (격리 PostgreSQL, 24 migrations, 1 suite/4 tests, 임시 DB 삭제).
두 조직과 Admin·Developer·Knowledge Manager·Viewer permission fixture로 앱·credential·사용량·
요청 로그의 HTTP 허용/거부, 타 조직 404, 원문 key 비저장, production fixture 기동 차단을 검증했다.
`npm run verify`: Pass (서버 497개, Console Web 24개, demo 56개 포함).
브라우저·실제 AWS·운영 DB·원격 CI·배포는 미실행이며 다음은 M3-03 브라우저 E2E다.

### M3-03 검증 추가 기록 — 2026-09-23

`start:console-browser-fixture`로 무작위 localhost PostgreSQL DB에 24개 migration을 적용하고
AI Server와 Console Web을 기동했다. Playwright CLI headed Chromium에서 앱 생성, Key 발급,
실제 `/knowledge/answers`, 사용량·로그 상세, 5분 grace 회전, 이전/신규 Key 성공, 이전 Key
폐기 후 401과 신규 Key 성공을 확인했다. 성공 4건만 사용량·로그에 집계됐으며 브라우저
localStorage/sessionStorage는 비어 있었다. 종료 후 임시 DB를 삭제했다.

지식 자료가 없어 실제 검색 뒤 `insufficient_evidence`로 종료됐고 provider 대체는 사용하지
않았다. Bedrock 생성 provider는 호출되지 않았다(`modelInvoked: false`). `npm run verify`는
서버 497개, Console Web 24개, demo 56개를 포함해 Pass했다. 실제 AWS·운영 DB·원격 CI·배포는
미실행이며 다음은 M3-04다.

### M3-04 검증 추가 기록 — 2026-09-23

`test:console-regression-db`가 한 임시 PostgreSQL DB에서 M1 한도·중복·실패 복구 16개와
M2 집계·cursor·CSV 5,000행 제한 8개를 직렬 실행하도록 연결했다. 서로 다른 임시 DB로
두 번 반복해 매회 24/24 통과와 DB 삭제를 확인했다.

Quality Gate에 digest 고정 `pgvector/pgvector:pg16` service 기반 독립 `console-db-regression` job을
추가했다. 동일 image를 로컬 Docker의 별도 port로 기동한 대등 환경에서도 24/24 통과하고
container와 임시 DB가 정리됐다. GitHub Actions 원격 실행·운영 DB·AWS·배포는 미실행이며
다음은 M3-05 전체 품질 검사와 작업본 기준 기록이다.

### M3-05 및 M3 완료 기록 — 2026-09-23

기준은 `codex/demo-api-validation` branch의 base HEAD
`08a210e727ffa585da037bea11231413ee1524ff`에 M3 변경을 포함한 미커밋 작업본이다.
Windows 11 Home 10.0.26200 x64, Node.js 24.15.0, npm 11.12.1, Prisma 7.9.1,
TypeScript 5.9.3, PostgreSQL 18.4, Docker 29.8.0에서 검증했다.

단독 `npm run verify`는 서버 497개, Console Web 24개, demo 56개를 포함해 Pass했다.
`test:console-regression-db` 24개, `test:console-access-db` 4개, `test:console-web-gate`도
Pass했고 각 실 DB 실행 후 임시 DB 삭제를 확인했다. M3-03의 headed 브라우저 대표 여정은
같은 날짜의 기존 증거를 재사용했으며 M3-05에서는 재실행하지 않았다.

초기 병렬 실행에서는 Web gate가 내부 verify를 동시에 실행하는 동안 주 verify의 Jest가
상세 로그 없이 exit 1이었고, 단독 재실행은 전체 통과했다. 최종 품질 검사는 Web gate와
동시에 실행하지 않는 조건을 기록했다. 원격 CI·운영 DB·AWS·배포는 미실행이다.

M3는 5/5 완료했고 M4는 진행 중(1/5)이다. 다음은 M4-02다.

### M4-01 검증 추가 기록 — 2026-09-23

조직 월 요청·token committed 사용량의 70/90/100% event를 usage transaction에 연결하고,
조직·UTC 월·지표·임계치 unique로 동시성 중복을 방지했다. 저장 실패 rollback과 재시도,
월 변경·무제한·0·한도 변경 정책은 사용량 계약 §4에 기록했다. 외부 알림 전달은 M4-04에 남겼다.

단위·migration 계약 39개, `test:usage-quota-db` 17개, `test:console-regression-db` 25개와
`npm run verify`가 통과했다. 전체 verify는 서버 63 suites/501 tests, Console Web 24개,
demo 56개를 포함한다. 신규 25번째 migration은 격리 PostgreSQL에만 적용했으며 운영 DB·
원격 CI·알림 발송·배포는 미실행이다. M4는 1/5 진행 중이며 다음은 M4-02다.

### M4-02 검증 추가 기록 — 2026-09-23

`/console` 홈에서 기존 조직 범위 월 사용량·앱·실패 로그 API를 병렬 조회한다. 당월 요청·token
committed와 확정/예약, 잔여 한도, 성공률·p95, 최근 오류 5건, 가까운 Key 만료 5개를 표시한다.
M5 지식 색인 실패 계약은 `failedJobs`, `lastFailureAt`, `affectedApps`로 고정하고 연결 전에는
미측정으로 표시한다. 오류 원문은 노출하지 않으며 모바일 한 열 layout을 추가했다.

`node --check`, Console Web 27개, typecheck, lint와 전체 `npm run verify`가 통과했다.
전체 verify는 서버 63 suites/501 tests, Console Web 27개, demo 56개를 포함한다. 실제 브라우저·
운영 DB·원격 CI·배포는 미실행이며 M4-05에서 홈 탐색·모바일·키보드 브라우저 회귀를 수행한다.
M4는 2/5 진행 중이며 다음은 M4-03이다.

### M4-03 검증 추가 기록 — 2026-09-28

`audit:read` 전용 조직 범위 감사 API와 활동·보안 화면을 추가했다. 기간·event·앱·Works 사용자
필터와 cursor를 지원하며 session hash, credential/recovery key, 임의 metadata와 원문을 반환하지
않는다. 저장 정책은 일반 Console 변경은 commit 뒤 best-effort, 결정 원장 감사는 transaction
fail-closed로 확정했다. 상세는 [감사 계약](HJ_AI_CONSOLE_AUDIT_CONTRACT.md)을 따른다.

단위·HTTP 10개, 실 PostgreSQL Console 접근 5개, Web 30개와 전체 verify가 통과했다.
전체 verify는 서버 65 suites/507 tests, Console Web 30개, demo 56개를 포함한다. 실제 브라우저·
운영 DB·원격 CI·운영 배포는 미실행이다. M4는 3/5 진행 중이며 다음은 M4-04다.

### M4-04 검증 추가 기록 — 2026-09-28

현재 UTC 월의 조직 임계치 event를 반환하는 `usage:read` 전용 `/usage/alerts`와 홈 내부
알림함을 연결했다. 채널은 외부 발송 없는 `console-inbox`, 수신자는 활성 membership의
`usage:read` 사용자, 재전송은 같은 event ID를 안전하게 다시 읽는 `idempotent-refetch`다.
홈은 0·무제한·미측정·읽기 전용·빈 상태를 구분하고 앱·최근 오류·알림 API의 부분 실패를
해당 패널 오류와 재시도로 표시한다.

관련 단위·HTTP 11개, 실 PostgreSQL Console 접근 5개, Web 31개와 전체 verify가 통과했다.
전체 verify는 서버 65 suites/509 tests, Console Web 31개, demo 56개를 포함한다. 외부 메시지,
실제 브라우저·운영 DB·원격 CI·AWS·운영 배포는 실행하지 않았다. M4는 4/5 진행 중이며
다음은 M4-05 최종 DB·브라우저 회귀다.
