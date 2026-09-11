# HJ-Works 연계 AI Console 구축 계획

작성일: 2026-09-11  
대상 서비스: HJ AI Server, HJ-Works, HJ AI Console  
목표 주소: `https://ai.hjshub.com/console`  
상태: `CON-WORKS-01` 인증 조사 완료, 사용자·조직 계약 확정 전

> 2026-09-11 조사 결과 HJ-Works는 범용 OIDC Provider가 아니라 Firebase 기반 Works
> 플랫폼 세션과 60초·1회용 서비스 인가 코드 교환 계약을 제공한다. AI Console MVP는
> 이 SSO v1을 재사용하고, 권한 회수 전파·AI 전용 permission·PKCE는 후속 계약에서
> 보완한다. 상세 내용은 [HJ-Works 연계 인증 조사 결과](HJ_WORKS_AUTH_DISCOVERY_2026-09-11.md)를
> 참조한다.

## 1. 목적

HJ AI Console은 HJ-Works 사용자가 별도 회원가입 없이 접근하여 자신이 속한 조직의
AI 애플리케이션, API credential, 사용량, 요청 이력, 지식 자료와 운영 설정을 관리하는
셀프서비스 포털이다.

HJ-Works는 사용자·조직·멤버십·계정 상태의 기준 시스템으로 유지한다. AI Console은
AI 애플리케이션과 사용량의 기준 시스템이며, HJ-Works 데이터베이스를 직접 공유하지
않고 안정적인 identity 계약을 통해 필요한 최소 사용자 정보만 동기화한다.

## 2. 성공 기준

다음 조건을 모두 만족하면 1차 운영 MVP를 완료한 것으로 판단한다.

1. 활성 HJ-Works 사용자가 `/console`에서 Works 로그인을 거쳐 별도 가입 없이 진입한다.
2. 사용자는 Works에서 권한을 받은 조직과 그 조직에 연결된 AI 앱만 조회·관리한다.
3. 브라우저에 플랫폼 관리자 credential이나 API key 원문을 지속 저장하지 않는다.
4. 앱 생성, API key 일회성 발급·회전·폐기와 실제 API 호출 확인이 가능하다.
5. 앱별 월 요청량, token, embedding, 성공률, 오류와 지연시간을 조회할 수 있다.
6. 권한 변경, 조직 탈퇴, 사용자 정지가 짧은 유예시간 안에 Console 접근에 반영된다.
7. 로그인, 앱·키·멤버·지식 변경이 Works 사용자 ID와 요청 ID를 포함한 감사 기록으로 남는다.
8. tenant 격리, 인증 실패, 세션 폐기와 key 비노출 계약이 자동 통합 시험을 통과한다.

## 3. 범위

### 3.1 MVP 포함

- HJ-Works SSO와 통합 로그아웃
- Works 사용자·조직·멤버십·계정 상태 동기화
- 조직 선택과 조직 단위 권한 검사
- 조직별 AI 앱 목록·생성·수정·비활성화
- API key 발급·회전·폐기와 만료 상태 조회
- Playground와 빠른 시작 예제
- 요청량·token·embedding·성공률·지연·오류 사용량 화면
- 지식 파일 목록·업로드·색인·재색인·게시·보관
- 사용자 활동 및 보안 감사 이력
- 월 사용 한도와 70%, 90%, 100% 임계치 알림 기반

### 3.2 후속 범위

- 온라인 결제, 세금계산서와 자동 청구
- 외부 고객용 공개 회원가입
- 조직별 SAML/OIDC federation
- SCIM provisioning
- 고객이 임의 모델과 system prompt를 선택하는 기능
- 플랫폼 전체 인프라·모델·다른 고객 정보를 다루는 운영자 기능

## 4. 시스템 책임과 신뢰 경계

| 영역 | 기준 시스템 | 책임 |
| --- | --- | --- |
| 사용자 신원 | HJ-Works | 사용자 ID, 로그인, MFA, 활성·정지 상태 |
| 조직과 멤버십 | HJ-Works | 조직 ID, 소속, 서비스 권한 |
| Console 세션 | AI Console | Works 인증 결과 검증, 브라우저 세션, CSRF 방어 |
| AI 앱 | AI Server | AppInfo, appcode, 상태, 모델·검색 기본 정책 |
| API credential | AI Server | 발급, hash 보관, 만료, 회전, 폐기 |
| 지식 | AI Server | 파일, 정책, 색인 job, chunk와 tenant 격리 |
| 사용량 | AI Server | 요청·token·embedding·지연·오류 원본 및 집계 |
| 결제·플랜 | AI Console | MVP에서는 관리자 지정 플랜과 한도만 관리 |

HJ-Works와 AI Console은 데이터베이스를 공동 사용하지 않는다. Console은 Works의 불변
식별자를 외래 참조 값으로 저장하고, 사용자 표시 정보는 UI와 감사에 필요한 최소 범위만
캐시한다.

## 5. 목표 구성

```text
HJ-Works Web
  └─ 연계 서비스 > HJ AI Console
       └─ https://ai.hjshub.com/console
            ├─ Console Web/BFF
            │    ├─ Works OIDC code 교환
            │    ├─ HttpOnly Console session
            │    └─ CSRF·조직 context 검증
            └─ Console API
                 ├─ Works identity/RBAC
                 ├─ AppInfo·key 관리
                 ├─ 사용량·감사 조회
                 └─ 지식 운영

외부 애플리케이션
  └─ https://ai.hjshub.com/v1/* + appkey

HJ 내부 플랫폼 운영자
  └─ https://ai.hjshub.com/admin/v1/* + 내부 관리자 identity
```

권장 공개 경로는 다음과 같다.

| 경로 | 용도 | 인증 |
| --- | --- | --- |
| `/console/*` | Console UI와 BFF | Works 기반 Console session |
| `/console-api/v1/*` | 일반 사용자용 관리 API | Works identity와 조직 RBAC |
| `/v1/*` | 외부 앱의 AI 호출 | appkey |
| `/admin/v1/*` | HJ 내부 플랫폼 운영 | 내부 관리자 identity |
| `/validation/*` | 검증 콘솔 | 기존 제한 접근 유지 |

일반 사용자가 기존 정적 `ADMIN_API_KEY` 또는 `KNOWLEDGE_OPERATOR_API_KEY` 기반 API를
대신 호출하는 구조로 만들지 않는다.

## 6. HJ-Works 인증 계약

### 6.1 권장 프로토콜

장기 목표는 HJ-Works가 OpenID Connect Provider 역할을 하고 AI Console을 confidential
client로 등록하는 것이다. 다만 현재 Works에는 표준 OIDC가 아닌 60초·1회용 서비스
인가 코드와 backend 교환 계약이 구현되어 있다. AI Console MVP는 이 SSO v1을 사용하고,
표준 OIDC 전환은 서비스 확장과 외부 federation 필요성에 따라 별도 결정한다.

HJ-Works 프로젝트에서 다음 기능의 현재 지원 여부를 먼저 확인한다.

- authorization endpoint
- token endpoint
- JWKS endpoint와 signing key rotation
- userinfo 또는 사용자 조회 endpoint
- logout 또는 token revocation endpoint
- AI Console 전용 client ID, redirect URI와 audience
- MFA 및 계정 정지 정책

현재 SSO v1은 등록 callback과 backend client secret, 원본 Works 세션에 결합된 일회용
code를 사용한다. 사용자 정보나 client secret을 query string에 전달하지 않으며,
callback의 code는 Console backend가 즉시 교환한 뒤 폐기한다.

### 6.2 로그인 흐름

1. 사용자가 `/console` 또는 HJ-Works 앱 런처에서 진입한다.
2. Console BFF가 유효한 세션이 없으면 고엔트로피 `state`를 생성·저장하고 Works
   `/sso/authorize`로 이동시킨다.
3. Works에서 로그인과 회사 선택을 완료한다.
4. Works가 등록 callback으로 60초·1회용 code와 state를 반환한다.
5. Console BFF가 state의 일치·만료·단일 사용을 검증한다.
6. Console backend가 등록 client ID, client secret과 callback으로 code를 교환한다.
7. 교환 결과의 만료, user/tenant ID 일관성과 허용 상태를 검증한다.
8. Works 사용자와 tenant binding을 upsert한다.
9. Console 전용 session ID를 `HttpOnly`, `Secure`, `SameSite=Lax` cookie로 발급한다.

### 6.3 SSO v1 필수 응답

| 필드 | 의미 | 규칙 |
| --- | --- | --- |
| `userId`, `user.id` | Works 사용자 ID | 동일한 UUID여야 함 |
| `tenantId`, `tenant.id` | Works 회사 ID | 동일한 UUID여야 함 |
| `membershipRole` | 회사 역할 | `OWNER`, `ADMIN`, `MEMBER` 중 하나 |
| `user.email` | 검증된 이메일 | 표시·알림용, 관계 key로 사용 금지 |
| `user.displayName` | 표시 이름 | 최소 캐시만 허용 |
| `tenant.name`, `tenant.slug` | 회사 표시 정보 | tenant binding 보조 정보 |
| `expiresAt` | 교환 결과 만료 | 만료 결과 거절 |

교환된 조직과 권한 정보를 장기 세션 동안 고정된 것으로 신뢰하지 않는다. 권한 변화
반영을 위해 짧은 Console session, Works 조회 또는 서명된 이벤트를 후속 계약으로 정한다.

### 6.4 사용자 정보 최소 공유

| 필드 | 저장 여부 | 용도 |
| --- | --- | --- |
| `worksUserId` | 필수 | 사용자 binding과 감사 actor |
| `worksOrganizationId` | 필수 | tenant·소유권 경계 |
| 표시 이름 | 캐시 | 화면·감사 표시 |
| 이메일 | 제한적 캐시 | 알림과 사용자 확인 |
| 프로필 이미지 URL | 선택 | 화면 표시 |
| 계정 상태 | 캐시 | 접근 차단 |
| 마지막 동기화 시각 | 필수 | stale 상태 진단 |

이메일이나 표시 이름을 관계 key로 사용하지 않는다. 사용자 원본 profile, 비밀번호, MFA
secret은 Console로 복제하지 않는다.

## 7. 권한 모델

HJ-Works에서 조직별 AI Console 서비스 권한을 관리하는 것을 목표로 한다.

| Works 서비스 권한 | Console 역할 | 권한 |
| --- | --- | --- |
| `AI_CONSOLE_OWNER` | Owner | 조직 연결, 플랜, 앱, 멤버 전체 관리 |
| `AI_CONSOLE_ADMIN` | Admin | 앱·key·사용량·지식·멤버 관리 |
| `AI_DEVELOPER` | Developer | key, Playground, 로그와 사용량 |
| `AI_KNOWLEDGE_MANAGER` | Knowledge Manager | 지식 업로드·정책·색인·보관 |
| `AI_BILLING` | Billing | 사용량·플랜·청구 읽기 |
| `AI_VIEWER` | Viewer | 앱·사용량 읽기 전용 |

세부 권한은 역할 문자열을 controller에서 직접 비교하지 않고 permission으로 변환한다.

```text
apps:read, apps:write
credentials:read, credentials:rotate, credentials:revoke
usage:read, logs:read
knowledge:read, knowledge:write
members:read, members:manage
billing:read, billing:manage
audit:read
```

HJ 내부 플랫폼 관리자는 별도 realm과 정책을 유지한다. Works 조직 Owner에게 다른 조직
조회, 모델 전역 설정, 인프라 설정 또는 플랫폼 관리자 권한을 부여하지 않는다.

## 8. 데이터 모델 변경안

최종 이름은 구현 시 기존 Prisma naming과 migration 정책에 맞춰 확정한다.

### 8.1 신규 entity

```text
ConsoleOrganization
- id
- worksOrganizationId (unique)
- displayName
- status
- planCode
- monthlyRequestLimit
- monthlyTokenLimit
- createdAt, updatedAt, lastSyncedAt

ConsoleIdentity
- id
- worksUserId (unique)
- displayName
- email
- profileImageUrl
- status
- createdAt, updatedAt, lastSyncedAt

ConsoleMembership
- organizationId
- identityId
- worksRoleVersion 또는 membershipVersion
- roles/permissions cache
- status
- lastSyncedAt
- unique(organizationId, identityId)

ConsoleSession
- idHash
- identityId
- selectedOrganizationId
- expiresAt
- revokedAt
- lastSeenAt
- userAgentHash, ipPrefix 또는 정책상 허용된 접속 metadata

ConsoleAppOwnership
- organizationId
- appInfoId (unique)
- createdByIdentityId
- createdAt

ConsoleNotificationRule
- organizationId
- appInfoId nullable
- metric
- thresholdPercent
- channel
- enabled
```

### 8.2 기존 모델과 연결

- 기존 `AppInfo`의 `id`와 `appcode`를 유지한다.
- 조직 소유권은 명시적인 FK 또는 `ConsoleAppOwnership`으로 연결한다.
- 기존 appcode 기반 지식·query log 격리는 유지하되 모든 Console 진입은 먼저 조직 소유권을 검사한다.
- 감사 actor에 `worksUserId`, 조직 ID와 Console session ID hash를 추가한다.
- API key 원문은 기존과 같이 생성·회전 응답에서만 반환하고 hash만 저장한다.

## 9. Console API 초안

### 9.1 세션과 사용자

```http
GET  /console-api/v1/session
POST /console-api/v1/session/select-organization
POST /console-api/v1/session/logout
GET  /console-api/v1/me
GET  /console-api/v1/organizations
GET  /console-api/v1/organizations/:organizationId/members
```

### 9.2 앱과 credential

```http
GET    /console-api/v1/apps
POST   /console-api/v1/apps
GET    /console-api/v1/apps/:appId
PATCH  /console-api/v1/apps/:appId
POST   /console-api/v1/apps/:appId/credentials
POST   /console-api/v1/apps/:appId/credentials/rotate
DELETE /console-api/v1/apps/:appId/credentials/:credentialId
```

기존 AppInfo가 단일 활성·이전 appkey만 지원하므로 MVP에서 여러 독립 credential이
필요한지 먼저 결정한다. 1차에는 기존 회전 계약을 UI로 노출하고, 환경·팀별 복수 key는
후속 schema로 분리할 수 있다.

### 9.3 사용량과 로그

```http
GET /console-api/v1/usage/summary?from=&to=&appId=
GET /console-api/v1/usage/timeseries?interval=day&from=&to=&appId=
GET /console-api/v1/usage/breakdown?dimension=endpoint|model|status
GET /console-api/v1/request-logs?appId=&status=&requestId=&cursor=
GET /console-api/v1/request-logs/:requestId
```

기본 화면 지표는 요청 수, 성공률, input/output token, embedding 작업, p50/p95 지연,
429·timeout·5xx와 월 한도 사용률이다. 질문·응답 원문은 기본 목록에 노출하지 않고
앱별 content logging·보존 정책을 적용한다.

### 9.4 지식 관리

```http
GET    /console-api/v1/apps/:appId/knowledge/files
POST   /console-api/v1/apps/:appId/knowledge/files
GET    /console-api/v1/apps/:appId/knowledge/files/:fileId
PATCH  /console-api/v1/apps/:appId/knowledge/files/:fileId/policy
POST   /console-api/v1/apps/:appId/knowledge/files/:fileId/index-jobs
POST   /console-api/v1/apps/:appId/knowledge/files/:fileId/reindex-jobs
GET    /console-api/v1/apps/:appId/knowledge/index-jobs/:jobId
POST   /console-api/v1/apps/:appId/knowledge/index-jobs/:jobId/retry
DELETE /console-api/v1/apps/:appId/knowledge/files/:fileId
```

Console API는 기존 지식 service를 재사용하되 사용자 identity, permission과 조직 소유권을
검사한다. 브라우저가 내부 관리자 credential을 전달하도록 하지 않는다.

## 10. 화면 구조

```text
/console
/console/select-organization
/console/apps
/console/apps/:appId/overview
/console/apps/:appId/credentials
/console/apps/:appId/playground
/console/apps/:appId/usage
/console/apps/:appId/logs
/console/apps/:appId/knowledge
/console/members
/console/billing
/console/security
/console/settings
```

### 10.1 홈

- 선택 조직과 앱 전환
- 이번 달 요청, token, embedding, 성공률, p95, 한도 사용률
- 최근 오류와 지식 색인 실패
- key 만료와 한도 임계치 알림

### 10.2 앱

- 앱 생성, 이름·설명 변경, 활성화 상태
- appcode는 서버 생성 후 읽기 전용
- API base URL과 빠른 시작 예제
- 허용된 AI 기능과 기본 정책 표시

### 10.3 API credential

- 새 key 원문 일회성 표시와 복사 확인
- 만료일, 발급자, 발급·마지막 사용 시각
- grace period가 있는 회전과 이전 key 종료 시각
- 폐기 확인과 감사 이력

### 10.4 사용량과 로그

- 기간·앱·endpoint·상태별 필터
- 일·시간 단위 추이
- 오류 code와 request ID 기반 진단
- CSV export는 권한과 최대 기간·행 수를 제한

### 10.5 지식 관리

- 파일 목록, 정책, 게시 상태와 색인 상태
- 업로드, 재색인, 보관과 안전한 삭제
- job attempt, retryable, 다음 재시도와 correlation ID

## 11. 동기화와 계정 수명주기

### 11.1 로그인 시 동기화

- 사용자와 조직 상태를 매 로그인 시 확인한다.
- 캐시 TTL을 넘긴 세션은 다음 민감 작업 전 Works 상태를 재확인한다.
- 여러 조직에 속한 사용자는 명시적으로 조직을 선택한다.
- URL이나 요청 body의 조직 ID만으로 tenant를 변경하지 않는다.

### 11.2 이벤트 동기화

HJ-Works가 다음 서명 이벤트를 제공하도록 계약한다.

```text
user.updated
user.disabled
organization.updated
organization.disabled
membership.created
membership.role_changed
membership.removed
```

이벤트는 `eventId`, type, 발생 시각, schema version, 대상 Works ID와 payload checksum을
가진다. Console은 event ID 기반 idempotency, 순서 역전과 재전송을 처리한다.

### 11.3 폐기 기준

- 사용자 정지 또는 조직 membership 제거 시 해당 조직의 Console session을 폐기한다.
- 조직 비활성화 시 신규 API 호출과 key 발급을 차단한다.
- 기존 외부 appkey를 즉시 폐기할지 grace를 둘지는 조직 비활성 사유별 정책으로 분리한다.
- 표시 정보 삭제와 감사 증거 보존은 서로 다른 retention 정책을 적용한다.

## 12. 보안 및 개인정보 기준

- Works access/refresh token을 `localStorage`나 `sessionStorage`에 저장하지 않는다.
- 로그인 callback의 code, token, key 원문을 access log와 오류 추적에 남기지 않는다.
- 모든 변경 요청에 CSRF 보호, Origin 검증과 재인증 정책을 적용한다.
- 조직 ID, appId, fileId는 매 요청에서 서버 측 소유권을 확인한다.
- key 회전·폐기, 조직 설정과 멤버 변경에는 최근 인증 또는 MFA step-up을 검토한다.
- 사용자 이메일 등 개인정보는 암호화, 접근 권한, 보존기간과 삭제 절차를 정의한다.
- 질문·응답 원문은 기본 사용량 화면의 집계에 필요하지 않으며 최소 수집 원칙을 따른다.
- 감사 이벤트는 actor Works ID, 조직, 동작, 대상, 결과, request ID와 시각을 남긴다.
- 감사 로그 실패를 어디까지 fail-closed로 처리할지 동작별로 결정한다.
- 브라우저 응답에 관리자 credential, appkey hash, 내부 S3 key와 model 내부 설정을 노출하지 않는다.

## 13. 단계별 실행 계획

### 단계 0. HJ-Works 계약 확인

- [x] `CON-WORKS-01` Works 인증 구현과 OIDC Provider 지원 여부 조사 — SSO v1 재사용 판정,
  [조사 결과](HJ_WORKS_AUTH_DISCOVERY_2026-09-11.md)
- [ ] `CON-WORKS-02` 불변 user ID, organization ID와 membership 계약 확정
- [ ] `CON-WORKS-03` AI Console 서비스 역할과 permission 소유 시스템 확정
- [ ] `CON-WORKS-04` account·membership 변경 event와 재전송 계약 확정
- [ ] `CON-WORKS-05` 로그아웃, MFA, 정지·탈퇴와 개인정보 정책 확정

완료 기준: 두 프로젝트가 사용할 versioned 인증·사용자·이벤트 계약과 테스트 fixture가
승인된다.

### 단계 1. identity와 tenant 기반

- [ ] `CON-SRV-01` Console organization, identity, membership, session schema와 migration
- [ ] `CON-SRV-02` Works OIDC 검증, callback과 session service
- [ ] `CON-SRV-03` 조직 선택과 permission guard
- [ ] `CON-SRV-04` Works 동기화와 서명 event idempotency
- [ ] `CON-SRV-05` 감사 actor를 Works identity와 조직으로 확장
- [ ] `CON-WEB-01` 로그인, callback, 조직 선택, 접근 거부 화면

완료 기준: 두 조직·세 역할 fixture에서 로그인, 조직 격리, role 변경, membership 제거와
session 폐기 E2E가 통과한다.

### 단계 2. 앱과 API credential MVP

- [ ] `CON-SRV-06` 사용자용 앱 목록·상세·생성·수정 API
- [ ] `CON-SRV-07` 조직 소유권과 기존 AppInfo 연결
- [ ] `CON-SRV-08` 사용자용 key 발급·회전·폐기 API
- [ ] `CON-SRV-09` key 마지막 사용 시각과 발급 actor metadata
- [ ] `CON-WEB-02` 앱 목록·생성·상세 화면
- [ ] `CON-WEB-03` key 일회성 표시·회전·폐기 UX
- [ ] `CON-WEB-04` Playground와 빠른 시작 예제

완료 기준: Works Admin이 앱을 생성하고 key를 한 번 확인한 뒤 실제 `/v1` 호출을
성공시키며, Developer·Viewer의 허용·거부 계약이 자동 검증된다.

### 단계 3. 사용량과 운영 가시성

- [ ] `CON-SRV-10` 요청·token·embedding 집계 schema 또는 query 확정
- [ ] `CON-SRV-11` summary·timeseries·breakdown API
- [ ] `CON-SRV-12` 조직 범위 request log 목록·상세 API
- [ ] `CON-SRV-13` 월 한도와 원자적 예약·정산 정책
- [ ] `CON-SRV-14` 임계치 알림 event와 중복 방지
- [ ] `CON-WEB-05` 홈 dashboard와 사용량 차트
- [ ] `CON-WEB-06` 요청 로그, 오류 상세와 CSV export

완료 기준: 집계 합계가 원본 실행 기록과 일치하고, tenant 교차 조회가 실패하며,
명시적 0과 미측정 값이 구분된다.

### 단계 4. 지식 관리

- [ ] `CON-SRV-15` Console identity 기반 지식 운영 facade
- [ ] `CON-SRV-16` 앱 소유권과 Knowledge Manager permission 적용
- [ ] `CON-WEB-07` 파일 목록·업로드·정책 화면
- [ ] `CON-WEB-08` 색인 진행·실패·재시도·보관 UX

완료 기준: 브라우저에 관리자 credential이 없는 상태로 업로드부터 답변, 재색인, 보관까지
완료하고 STORE_A/B 유형의 조직 격리 회귀를 통과한다.

### 단계 5. 운영 배포와 승인

- [ ] `CON-OPS-01` `/console`과 `/console-api` reverse proxy·CORS·CSP 구성
- [ ] `CON-OPS-02` OIDC secret과 signing key rotation 운영 절차
- [ ] `CON-OPS-03` migration backup·rollback rehearsal
- [ ] `CON-OPS-04` metric·alert·dashboard와 runbook
- [ ] `CON-OPS-05` dependency·image scan과 배포 gate
- [ ] `CON-OPS-06` 내부 pilot, 독립 보안·접근성 검수와 단계적 공개

완료 기준: 운영 후보에서 login, key, 사용량, 지식 대표 여정과 rollback을 검증하고 승인자가
배포 기록에 서명한다.

## 14. 테스트 전략

### 14.1 계약 시험

- Works issuer·audience·signature·만료·nonce 검증
- 변경되거나 알 수 없는 claim과 event schema fail-closed
- Works ID와 Console binding의 versioned fixture
- permission matrix 전수 검사

### 14.2 격리·보안 시험

- 다른 조직 appId·fileId·requestId 직접 대입 시 404 또는 정책상 동일한 비노출 응답
- Viewer·Developer·Knowledge Manager·Admin 역할별 허용·거부
- 사용자 정지·membership 제거·role 변경 후 session 갱신 및 폐기
- CSRF, callback replay, state mismatch와 open redirect 차단
- key 원문·hash, Works token과 개인정보의 응답·로그 비노출

### 14.3 기능 시험

- 앱 생성 → key 발급 → `/v1` 호출 → 사용량 반영
- key 회전 grace → 신규 key 성공 → 이전 key 만료 후 401
- Playground 요청과 request ID 로그 연결
- 지식 upload → index → search/answer → archive
- 월 한도 경계의 동시 요청과 중복 operation

### 14.4 운영 시험

- OIDC/JWKS 또는 Works 사용자 API 단절 시 안전한 실패
- signing key rotation 중 무중단 로그인
- event 중복·지연·순서 역전 복구
- Console 배포 중 기존 AI API 무중단
- migration rollback과 기존 AppInfo/appkey 호환

## 15. 배포 전략

1. schema와 API를 feature flag 비활성 상태로 먼저 배포한다.
2. HJ-Works staging client와 두 조직·여러 역할 fixture를 연결한다.
3. HJ 내부 pilot 조직만 Works allowlist와 Console feature flag로 활성화한다.
4. read-only dashboard를 먼저 공개한다.
5. 앱 생성과 key 관리, 지식 쓰기 기능을 순서대로 활성화한다.
6. 오류율, 인증 실패, tenant 거부, p95와 audit 누락을 관찰한다.
7. 이상 시 Console 경로만 비활성화하고 기존 `/v1` AI 호출은 유지한다.

rollback은 Console UI, Console API feature flag, 앱 image와 DB migration을 분리한다.
additive migration을 우선하며 destructive schema 정리는 호환 기간 이후 별도 릴리스로 한다.

## 16. 주요 위험과 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| Works가 OIDC Provider를 제공하지 않음 | 전체 일정 지연 | 단계 0에서 인증 제공 기능을 선행 deliverable로 확정 |
| 조직·멤버십 정보가 token에서 오래 유지됨 | 권한 철회 지연 | 짧은 TTL, 민감 작업 재조회, 서명 event와 session 폐기 |
| 기존 AppInfo에 조직 소유권이 없음 | tenant 오연결 | 명시적 ownership migration과 중복·미소유 preflight |
| 정적 관리자 key를 BFF가 대리 사용 | 권한 확대·감사 주체 손실 | identity-aware Console API와 permission guard 구현 |
| 사용량 집계 비용 증가 | DB 부하 | 원본과 집계 분리, 기간 제한, cursor, 필요 시 rollup table |
| key 원문 유출 | 고객 시스템 침해 | 일회성 표시, hash 저장, 로그 redaction, 재인증 |
| Works 장애가 Console 전체 장애로 전파 | 관리 기능 중단 | 짧은 세션 cache와 fail-closed 정책, 기존 AI 호출 경로 분리 |

## 17. 예상 일정

HJ-Works에 OIDC와 조직·권한 API가 이미 있다는 전제의 1인 기준 추정이다.

| 단계 | 예상 |
| --- | ---: |
| Works 계약 확인과 상세 설계 | 3~5일 |
| identity·조직·RBAC·세션 | 7~10일 |
| 앱·credential·Playground | 7~10일 |
| 사용량·로그·한도 | 7~10일 |
| 지식 관리 연결 | 4~7일 |
| 운영·보안·접근성 검증 | 5~7일 |
| 결제 제외 MVP 합계 | 약 6~8주 |

Works OIDC Provider 신규 구현이 필요하면 별도 일정과 독립 보안 검토를 추가한다.

## 18. 구현 전 확정 사항

1. HJ-Works의 현재 로그인 프로토콜과 OIDC Provider 지원 여부
2. 불변 Works 사용자·조직 ID의 형식과 수명주기
3. 조직별 AI Console 역할을 Works가 관리할지 Console이 관리할지
4. 한 사용자의 복수 조직 소속과 기본 조직 선택 규칙
5. 계정 정지·퇴사·조직 탈퇴 시 허용되는 최대 권한 철회 지연
6. MVP의 API credential을 기존 단일 회전 key로 제한할지 복수 key로 확장할지
7. 사용량 원본과 질문·응답 내용의 보존기간
8. 초기 pilot 조직, 월 한도와 알림 채널

이 항목의 결정 기록을 승인한 뒤 단계 1 schema와 공개 API 계약을 확정한다.
