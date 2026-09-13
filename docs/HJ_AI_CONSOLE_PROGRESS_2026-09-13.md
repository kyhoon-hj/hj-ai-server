# HJ AI Console 구현 진행 현황

작성일: 2026-09-13

대상 프로젝트: HJ AI Server

기준 계획: [HJ-Works 연계 AI Console 구축 계획](HJ_WORKS_AI_CONSOLE_IMPLEMENTATION_PLAN.md)

## 1. 작업 목표와 구현 순서

HJ-Works 사용자에게 조직 단위 AI 애플리케이션, API credential, 사용량, 지식 자료를
관리하는 셀프서비스 Console을 제공한다. 기능 개발을 먼저 완료하고 HJ-Works 로그인과
세션 통합은 마지막 기능 단계에서 수행하도록 순서를 변경했다.

현재 순서는 다음과 같다.

1. 앱과 API credential 관리
2. Playground와 사용량·운영 가시성
3. 지식 관리
4. HJ-Works 로그인·세션 최종 통합
5. 운영 배포와 승인

기능 개발 중에는 실제 인증 방식과 분리된 `ConsoleIdentityContext` fixture를 사용한다.
인증 통합 시 동일한 identity port의 구현체만 Works SSO/session adapter로 교체한다.

## 2. 완료한 작업

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

모든 앱·credential 작업은 organization ownership과 permission을 먼저 검사한다. 원문
credential은 발급 또는 회전 응답에서 한 번만 반환하며 저장소와 감사 로그에는 남기지
않는다.

## 4. 데이터베이스 변경

다음 additive migration을 작성했다.

- `20260912090000_add_console_identity_foundation`: 조직, identity, membership, 앱 ownership
- `20260912100000_extend_console_audit_actor`: Console·Works 감사 actor와 session hash
- `20260913100000_add_console_credential_metadata`: credential 식별자, 발급자와 사용 시각 metadata

마이그레이션 파일과 Prisma schema는 준비됐지만 운영 데이터베이스에는 아직 적용하지
않았다. 운영 적용은 단계 5의 배포 전 검증과 rollback 절차를 거쳐 수행한다.

## 5. Console Web/BFF 현황

- 기본 포트: `11003`
- 실행: `npm run start:console-web`
- 시험: `npm run test:console-web`
- AI Server의 `/console-api/*`를 같은 origin으로 proxy
- 앱 목록, 검색, 상태 필터, 생성, 상세와 수정 화면 제공
- credential 발급·회전 TTL/grace 설정과 폐기 확인 제공
- 원문 key dialog를 닫으면 DOM에서 제거하며 local/session storage에 저장하지 않음
- 모바일 폭에서 사용할 수 있는 반응형 navigation과 상태 UX 제공
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

운영 데이터베이스 migration과 HJ-Works 실계정 SSO 시험은 아직 수행 대상이 아니다.

## 8. 남은 작업과 다음 단계

즉시 다음 작업은 `CON-WEB-04` Playground와 빠른 시작 예제다. 이후 단계별 잔여 범위는
다음과 같다.

1. Playground에서 발급 key로 실제 `/v1` 요청을 실행하고 언어별 빠른 시작 예제 제공
2. 요청·token·embedding·성공률·지연·오류 집계 API와 dashboard·요청 로그 구현
3. 월 사용 한도, 원자적 예약·정산과 임계치 알림 구현
4. 조직 범위 지식 파일 업로드·색인·재시도·게시·보관 구현
5. HJ-Works 역할·변경 event 계약을 확정하고 로그인·세션·로그아웃 최종 통합
6. migration rehearsal, 보안·접근성 검수, 관측성·rollback 준비 후 단계적 운영 공개

`CON-WORKS-02`는 코드와 fixture 검증은 끝났지만 HJ-Works 측 공동 승인이 남아 있다.
로그인 통합 단계에 들어가기 전에 해당 계약과 역할·event 계약을 최종 확정해야 한다.
