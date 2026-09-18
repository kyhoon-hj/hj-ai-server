# HJ AI Console 구현 진행 현황

작성일: 2026-09-13

최종 갱신일: 2026-09-18

대상 프로젝트: HJ AI Server

기준 계획: [HJ-Works 연계 AI Console 구축 계획](HJ_WORKS_AI_CONSOLE_IMPLEMENTATION_PLAN.md)

현재 단계: **[Console M2 | 사용량·요청 로그·운영 지표 일치 | 대기 | 0/5]**

단계 상태·완료 기준·검증 이력의 기준 문서: [전체 마일스톤](HJ_AI_CONSOLE_MILESTONES.md).
M1-01~05 생성 API 연결·요청 중복 제거·예약 복구·경계 정책과 실제 PostgreSQL 검증을 완료했다. 검증 근거는 전체 마일스톤의 작업별 기록, 운영 절차는 [예약 복구 runbook](HJ_AI_CONSOLE_USAGE_RECOVERY_RUNBOOK.md)을 참조한다.

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
| `CON-SRV-05` | 완료 | 보안 감사 actor에 Console identity, Works ID, organization, session ID hash를 추가하고 기존 관리자 감사와 호환 유지 |
| `CON-SRV-06` | 완료 | Console 앱 목록·상세·생성·수정 API 구현 |
| `CON-SRV-07` | 완료 | 조직 소유권에 따른 조회 범위 제한, 타 조직 리소스 404 비노출, AppInfo와 ownership 원자적 생성 구현 |
| `CON-SRV-08` | 완료 | API key 일회성 발급·회전·폐기 API와 회전 grace 정책 구현 |
| `CON-SRV-09` | 완료 | credential ID, 발급 actor, 발급·만료·최근 사용 시각 metadata 저장과 조회 구현 |
| `CON-WEB-02` | 완료 | 독립 Console Web/BFF, 앱 검색·상태 필터·생성·상세 수정, 반응형 화면 구현 |
| `CON-WEB-03` | 완료 | credential metadata, 최초 발급·회전·개별 폐기, 원문 key 일회성 표시·복사·저장 확인 UX 구현 |
| `CON-WEB-04` | 완료 | 실제 지식 답변 Playground와 request ID·출처·지연 및 cURL·JavaScript·Python 예제 구현 |
| `CON-SRV-10` | 구현·보완 필요(M2) | 기본 통합 집계 구현. 로그와의 범위 일치·실패 계측·embedding 집계 범위 검증 잔여 |
| `CON-SRV-11` | 구현·보완 필요(M2) | 7·30·90일·일별·앱별 집계 구현. 월 사용률·p50/p95·차원별 집계 잔여 |
| `CON-SRV-12` | 구현·보완 필요(M2) | 목록·상세·cursor 구현. Family 로그와 Bedrock request ID·실패 기록·endpoint 필터 잔여 |
| `CON-SRV-13` | 완료(M1) | 예약·정산·복구·경계 정책 및 격리 PostgreSQL 16개, 관련 회귀 254개 통과. 운영 반영은 M7 |
| `CON-WEB-05` | 일부 완료 | 사용량 카드·일별 차트·앱별 표 완료, Console 홈 요약 화면 잔여 |
| `CON-WEB-06` | 구현·보완 필요(M2~M3) | 요청 로그·오류 상세·CSV 구현. 로그 범위·필터 확장과 브라우저 통합 검증 잔여 |

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
| `GET` | `/usage/summary` | 요청·token·embedding·성공률·지연 합계 조회 |
| `GET` | `/usage/timeseries` | UTC 일별 사용량 조회 |
| `GET` | `/usage/breakdown` | 조직 소유 앱별 사용량 조회 |
| `GET` | `/request-logs` | 요청 로그 필터·cursor 목록 조회 |
| `GET` | `/request-logs/:logId` | 원문을 제외한 요청 실행 상세 조회 |
| `GET` | `/request-logs/export.csv` | 최대 5,000행 metadata CSV 내보내기 |

모든 앱·credential 작업은 organization ownership과 permission을 먼저 검사한다. 원문
credential은 발급 또는 회전 응답에서 한 번만 반환하며 저장소와 감사 로그에는 남기지
않는다.

## 4. 데이터베이스 변경

다음 additive migration을 작성했다.

- `20260912090000_add_console_identity_foundation`: 조직, identity, membership, 앱 ownership
- `20260912100000_extend_console_audit_actor`: Console·Works 감사 actor와 session hash
- `20260913100000_add_console_credential_metadata`: credential 식별자, 발급자와 사용 시각 metadata
- `20260917100000_add_console_usage_reservation`: 월 한도 예약·정산·불확실 상태 원장
- `20260918100000_add_usage_reservation_recovery`: 로그 참조·복구 계수·멱등 key와 제약 (실제 DB 적용 미실행)
- `20260918110000_add_usage_reservation_policy`: operation 범위·0토큰 예약 식별·연결 실측 예약 보정 (실제 DB 적용 미실행)

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
기본 `verify`/CI에는 Console Web 검사가 아직 포함되지 않아 M3에서 연결한다.

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

즉시 다음 작업은 **M2-01 생성 경로 공통 요청 로그 계약과 성공/실패 기록**이다.
`CON-SRV-14` 알림보다 한도·집계·로그 정합성 보완을 먼저 수행한다.

1. M1: 완료. 실제 DB 검증 근거와 제한은 마일스톤 M1-05 기록 참조.
2. M2~M3: 사용량·요청 로그·월 지표 일치, 통합 검증과 Console Web CI 연결.
3. M4: 임계치 알림, 홈 요약, 조직 감사 조회.
4. M5: 조직 범위 지식 파일 업로드·색인·재시도·게시·보관.
5. M6: HJ-Works 계약 확정, 로그인·세션·로그아웃 최종 통합.
6. M7: migration rehearsal, 보안·접근성 검수, 관측성·rollback과 단계적 공개.

`CON-WORKS-02`는 코드와 fixture 검증은 끝났지만 HJ-Works 측 공동 승인이 남아 있다.
로그인 통합 단계에 들어가기 전에 해당 계약과 역할·event 계약을 최종 확정해야 한다.
