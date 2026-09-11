# HJ-Works 연계 인증 조사 결과

조사일: 2026-09-11  
작업 ID: `CON-WORKS-01`  
조사 대상: `C:\Work\HJSolution\hj-works\hj-works-v1-main`  
대상 브랜치·커밋: `agent/deploy-workone-integration`, `8e01580`  
판정: **기존 연계서비스 SSO v1을 AI Console MVP에 재사용 가능**

## 1. 결론

HJ-Works는 현재 범용 OpenID Connect Provider가 아니다. 대신 Firebase 로그인으로 확인한
사용자를 HJ-Works PostgreSQL 플랫폼 세션에 연결하고, 등록된 연계 서비스에 60초·1회용
인가 코드를 발급하는 자체 SSO 계약을 이미 제공한다.

AI Console MVP는 새로운 OIDC Provider 구현을 선행하지 않고 이 계약을 사용할 수 있다.
등록된 callback, 서비스 백엔드 client credential, 원본 Works 세션, 사용자·회사·서비스
상태를 모두 확인한 뒤 Works 사용자와 tenant 정보를 전달하므로 현재 목표인 Works 로그인
및 사용자·조직 공유의 기본 요구를 충족한다.

다만 교환 이후 Console 세션의 폐기 전파, AI 전용 permission, PKCE와 계약 version은
현재 계약에 없다. 이 항목은 후속 인증 계약과 Console 세션 설계에서 보완해야 한다.

## 2. 확인한 현재 인증 구조

```text
사용자
  → HJ-Works Firebase 로그인
  → POST /api/v1/auth/firebase/exchange
  → HJ-Works HttpOnly 플랫폼 세션
  → GET /sso/authorize?client_id=<AI Console client>&state=<opaque state>
  → POST /api/v1/auth/service-code
  → AI Console callback?code=<one-time code>&state=<opaque state>
  → AI Console backend가 POST /api/v1/auth/service-code/exchange
  → Works 사용자·tenant 정보 확인
  → AI Console 자체 세션 발급
```

확인한 HJ-Works 구현:

- `apps/api/src/auth/auth.controller.ts`
  - `GET /auth/services`
  - `POST /auth/service-code`
  - `POST /auth/service-code/exchange`
- `apps/api/src/auth/service-authorization.service.ts`
  - 회사별 서비스 배정 및 `INTEGRATIONS` 정책 확인
  - 60초 인가 코드 생성과 hash 저장
  - 등록 callback과 client credential 검증
  - 원본 Works 세션 연결 및 폐기·만료 확인
  - 사용자, tenant, membership, 서비스 상태 재검증
  - 원자적 일회 사용과 감사 기록
- `apps/api/prisma/schema.prisma`
  - `Service`, `ServiceCredential`, `TenantService`
  - `AuthSession`, `AuthorizationCode`
- `src/pages/ServiceAuthorize.tsx`
  - `client_id`와 필수 `state`를 검증한 뒤 현재 회사로 코드 발급

## 3. 교환 요청과 응답

AI Console backend는 callback에서 받은 코드를 다음 값과 함께 서버 간 교환한다.

```json
{
  "code": "one-time-authorization-code",
  "clientId": "registered-ai-console-client",
  "clientSecret": "server-side-secret",
  "redirectUri": "https://ai.hjshub.com/console/auth/callback"
}
```

HJ-Works의 현재 응답 계약은 다음 정보를 제공한다.

```json
{
  "userId": "works-user-uuid",
  "tenantId": "works-tenant-uuid",
  "membershipRole": "OWNER | ADMIN | MEMBER",
  "user": {
    "id": "works-user-uuid",
    "email": "verified-user@example.com",
    "displayName": "사용자 이름"
  },
  "tenant": {
    "id": "works-tenant-uuid",
    "name": "회사명",
    "slug": "company-slug"
  },
  "expiresAt": "ISO-8601"
}
```

교환 결과의 현재 유효기간은 5분이다. 이는 교환 응답의 신선도 계약이며, 대상 서비스가
생성한 세션의 만료나 폐기를 자동으로 강제하지 않는다.

## 4. AI Console 등록에 필요한 값

HJ-Works 플랫폼 관리자가 AI Console을 연계 서비스로 등록해야 한다.

| 항목 | 제안 값 |
| --- | --- |
| 서비스 code | `HJ_AI_CONSOLE` |
| 서비스명 | `HJ AI Console` |
| base URL | `https://ai.hjshub.com/console` |
| redirect URI | `https://ai.hjshub.com/console/auth/callback` |
| client ID | HJ-Works가 생성한 공개 식별자 |
| client secret | HJ-Works가 생성하고 Console backend에만 보관 |

서비스 등록 뒤 pilot Works tenant에 `TenantService` ACTIVE 배정이 필요하다. client secret은
Works의 보안키 조회 절차로 한 번 전달하고 AI Console 운영 secret 저장소에 보관한다.

## 5. 재사용 가능한 보안 속성

- Firebase UID 대신 HJ-Works 내부 사용자 UUID를 서비스 identity로 전달한다.
- 인가 코드는 60초 뒤 만료되고 hash로 저장된다.
- 인가 코드는 등록된 service, callback, 사용자, tenant와 원본 Works 세션에 결합된다.
- 코드 교환은 client ID와 client secret을 요구한다.
- 원본 Works 세션의 폐기, idle·absolute 만료와 회사 전환을 확인한다.
- 사용자·회사·membership·서비스 배정 중지는 교환 시 다시 확인한다.
- 코드 소비는 조건부 update로 한 번만 성공한다.
- 코드 발급과 교환을 Works 사용자·tenant 기준 감사 로그에 기록한다.
- 인증 전 실패 제한과 인증된 서비스 처리량 제한이 분리되어 있다.

## 6. 확인된 공백과 후속 요구사항

### 6.1 표준 OIDC가 아님

현재 계약은 authorization code와 backend JSON 교환 방식이지만 OIDC discovery, ID Token,
JWKS, 표준 scope·claim 또는 token revocation endpoint를 제공하지 않는다. AI Console은
이를 Works SSO v1 adapter로 명시하고 OIDC 호환을 주장하지 않는다.

### 6.2 교환 이후 권한 회수 전파 없음

Works 로그아웃·membership 제거·서비스 중지는 새 코드 발급과 교환을 차단한다. 이미
AI Console이 생성한 세션을 폐기하는 back-channel logout, event 또는 introspection은
현재 확인되지 않았다.

후속 `CON-WORKS-04`에서 다음 중 하나 이상을 계약해야 한다.

- 사용자·membership·tenant·service 상태 변경의 서명 event
- 민감 작업 전 Works session/entitlement introspection
- 짧은 Console session과 주기적 재인증

### 6.3 AI 전용 permission 부족

교환 응답의 역할은 `OWNER`, `ADMIN`, `MEMBER`뿐이다. API key, 지식, 사용량, 결제를
구분하는 AI Console permission은 없다. `CON-WORKS-03`에서 Works 서비스 권한 또는
Console 내부 permission의 기준 시스템을 결정해야 한다.

### 6.4 state 책임과 PKCE

HJ-Works UI는 8~200자의 opaque `state`를 필수로 검사하지만 API schema는 optional이고,
대상 서비스가 state를 생성·저장·단일 사용 검증해야 한다. PKCE는 현재 없다.

AI Console MVP는 반드시 서버가 생성한 고엔트로피 state를 HttpOnly 세션에 결합하여
callback에서 일치와 단일 사용을 검사한다. 인증 계약 v2에서는 PKCE S256과 필수 state를
검토한다.

### 6.5 서비스 시작 URL 표준화

HJ-Works 연계서비스 목록은 현재 특정 서비스만 별도 SSO 시작 경로를 사용하고 일반
서비스는 base URL을 연다. AI Console은 base URL 진입 시 자체적으로 state를 생성하여
Works `/sso/authorize`로 이동하는 흐름을 구현해야 한다. 장기적으로 서비스 registry에
인증 방식과 SSO 시작 URL을 명시한다.

### 6.6 다중 인스턴스 제한

코드 교환 rate-limit 저장소는 프로세스 메모리다. HJ-Works API가 다중 인스턴스로
확장되기 전에 공유 제한 저장소가 필요하다. 현재 단일 API 프로세스 운영에서는 알려진
제약으로 관리한다.

## 7. 결정

### 채택

- AI Console MVP 인증: HJ-Works 연계서비스 SSO v1
- 사용자 binding key: `(issuer=HJ_WORKS, userId)`
- 조직 binding key: `(issuer=HJ_WORKS, tenantId)`
- 사용자 표시 정보: 검증된 email과 displayName의 최소 캐시
- 브라우저 인증: AI Console 자체 HttpOnly session
- client secret: AI Console backend 운영 secret으로만 보관

### 보류

- HJ-Works 표준 OIDC Provider 구축
- PKCE를 포함한 SSO v2
- back-channel logout 또는 entitlement event
- AI 전용 Works permission 체계

보류 항목은 불필요하다는 뜻이 아니라 MVP 선행조건에서 분리한다는 의미다. 권한 회수
반영 시간과 민감 작업 재검증 정책은 Console 공개 전 반드시 확정한다.

## 8. 검증

HJ-Works 저장소에서 다음 계약 시험을 실행했다.

```powershell
node --import tsx --test `
  apps/api/src/auth/service-authorization.service.test.ts `
  packages/contracts/src/contracts.test.ts
```

결과:

```text
23 tests PASS
0 failures
```

확인한 계약에는 등록 credential·고정 callback 요구, state 형식, 사용자·tenant 결과의
일관성, 익명 실패 요청과 정상 서비스 제한의 분리가 포함된다. 실제 PostgreSQL E2E와
운영 서비스 등록·callback 호출은 이번 조사에서 실행하지 않았다.

## 9. 다음 작업

`CON-WORKS-02`에서 HJ-Works의 불변 사용자 ID, tenant ID, membership 상태와 변경
수명주기를 AI Console versioned contract로 확정한다. 동시에 AI Server의 AppInfo를
Works tenant에 연결할 migration preflight를 정의한다.
