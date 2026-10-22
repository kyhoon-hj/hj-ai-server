# HJ-Works 작업 지시서: HJ AI Console 운영 연계

작성일: 2026-10-14 (KST)

대상 프로젝트: **HJ-Works**. 이 문서는 HJ_AI_Server에서 작성한 인계 자료이며 Works 저장소와 운영 설정은 변경하지 않았다.

## 목적과 현재 AI Server 구현

운영 Works 사용자가 AI Console 연계 서비스를 열고, 선택한 회사의 Console에 로그인하여 승인된 권한으로 앱·키·사용량·지식을 관리하도록 한다.

AI Server 작업본에는 기존 SSO v1 코드 교환 수신부, 로그인 state의 DB 단일 사용, HttpOnly 세션, 로그아웃, 조직·멤버십·permission 검사와 Web BFF가 구현되어 있다. 운영 배포와 실계정 검증은 아직 수행하지 않았다. 현행 계약의 사용자·회사·역할 snapshot 유효기간을 넘기지 않는 최대 **5분 절대 세션**을 사용하며 자동 연장은 없다. 장기 세션은 별도 철회 계약과 AI Server 구현이 필요하다.

## W-CON-01. 실제 운영 계약 확인

Works 작업에서 해당 저장소의 AGENTS.md를 확인하고 현재 운영 revision의 SSO 소스를 조사한다. 2026-09-11 조사 기록은 현재 운영 계약을 보장하지 않는다.

확인할 경로:

- 웹: `/sso/authorize?client_id=<clientId>&state=<state>`
- 코드 발급: `POST /api/v1/auth/service-code`
- 백엔드 교환: `POST /api/v1/auth/service-code/exchange`
- 요청: `{ code, clientId, clientSecret, redirectUri }`
- 성공 응답: 아래 JSON의 최상위 객체. 응답 envelope가 있다면 실제 구조를 AI Server 작업에 전달해야 한다.

```json
{
  "userId": "<Works 사용자 UUID>",
  "tenantId": "<현재 회사 UUID>",
  "membershipRole": "OWNER",
  "user": { "id": "<동일 사용자 UUID>", "email": "pilot@example.com", "displayName": "Pilot User" },
  "tenant": { "id": "<동일 회사 UUID>", "name": "Pilot Company", "slug": "pilot" },
  "expiresAt": "<미래 ISO timestamp>"
}
```

AI Server는 UUID 일치, 알려진 역할 OWNER/ADMIN/MEMBER, 응답 필드·만료를 검사한다. 현재 구현은 위 응답에서 추가 필드를 허용하지 않는다. 실제 Works 응답이 다르면 검증을 느슨하게 바꾸지 말고 versioned 계약을 합의한다. UUID 비재사용·삭제/재가입 정책, MFA 적용 범위, 개인정보 보존 정책도 확정한다.

완료 기준: 실제 운영 코드·응답과 공유 fixture의 일치 또는 필요한 계약 변경안을 기록한다. 비밀키·실제 인가 코드는 기록하지 않는다.

## W-CON-02. AI Console 연계 서비스 등록·회사 배정

운영 Works 플랫폼 관리 절차로 다음 서비스와 credential을 등록한다. 기존 동일 code 등록이 있으면 중복 생성하지 않는다.

| 항목 | 값 |
| --- | --- |
| 서비스 code | `HJ_AI_CONSOLE` |
| 이름 | `HJ AI Console` |
| base URL | `https://ai.hjshub.com/console` |
| redirect URI | `https://ai.hjshub.com/console/auth/callback` (정확한 일치) |
| 로그인 시작 URL | `https://ai.hjshub.com/console/auth/login` |
| client ID | Works가 발급하는 실제 공개 식별자 |
| client secret | 기존 운영 secret 저장소로만 전달 |

Works 연계서비스 버튼은 위 시작 URL을 사용하면 Console이 state를 만든다. base URL 진입 시에도 로그인 버튼으로 같은 흐름에 들어갈 수 있다. Works에서 임의 state나 자체 callback 코드를 조합하지 않는다.

pilot 회사에 TenantService ACTIVE를 배정하고 현재 사용자·회사·membership·서비스 상태를 코드 발급/교환 시 재확인한다. 코드 60초 만료·일회 사용·등록 callback 검증을 유지한다. 기존 서비스 로그인은 회귀 검증한다.

완료 기준: 등록 client ID, 승인된 redirect URI, ACTIVE 회사 UUID, secret 저장 위치를 인계한다.

## W-CON-03. Console 권한 소유·복수 조직 계약

초기 구현에서는 **Console DB가 AI 세부 permission을 소유**하고 Works는 사용자 UUID·현재 회사 UUID·membershipRole을 증명한다. Works OWNER/ADMIN이라는 이유만으로 AI 관리 권한을 자동 부여하지 않는다. Console 조직·멤버십과 권한은 승인 manifest로 사전 등록한다. 실제 Works 역할과 승인된 Console worksRole이 다르면 로그인은 403으로 거절된다.

pilot 사용자 UUID·회사 UUID·실제 Works 역할과 승인할 AI 역할을 최소 두 조직·세 역할로 제공한다. 권장 AI 역할은 관리자, 지식 관리자, 조회자이며 구체 permission은 AI Server 인계서의 manifest 예시를 참고한다.

복수 조직은 **Works에서 회사 선택 → Console 로그인**으로 처리한다. AI Server에 전체 membership API가 없으므로 Console 안의 임의 조직 전환은 구현하지 않는다. Works 회사 전환·logout 뒤 이미 발급된 Console 세션은 만료까지 최대 5분 남을 수 있다.

완료 기준: permission 소유 시스템, 회사 선택 흐름, 최대 5분 철회 지연의 승인 또는 즉시 철회 요구를 명시한다.

## W-CON-04. 권한 회수·로그아웃 연계 계약

우선 기존 SSO v1을 사용한 최대 5분 세션 정책을 승인할지 판단한다. 승인하지 않거나 즉시 회수가 필요하면 다음 변경을 Works 작업에서 설계·구현하고 AI Server에 계약을 인계한다.

- 사용자·회사 정지, membership 역할 변경/삭제, 서비스 배정 해제, Works 세션 로그아웃의 상태 전달
- 선택지: 서버 간 entitlement/session introspection 또는 서명 event/back-channel logout
- introspection: 호출 URL, service 인증 방식, 원본 세션 식별자, 응답 version·활성 상태·회사/사용자/역할·유효 시각
- event: eventId, schemaVersion, occurredAt, 대상 UUID, 순서/version, HMAC 서명 canonical bytes·timestamp·replay 제한, key rotation, retry·ack 계약

**AI Server에는 아직 introspection/event 수신 endpoint가 없다.** URL이나 secret 이름을 임의로 운영 등록하지 않는다. 계약 확정 뒤 AI Server의 M6-03 구현과 양쪽 검증을 진행한다. 현재 로컬 DB 정지·삭제·역할 변경은 Console 다음 요청에서 거절하며 만료 세션은 거절된다.

완료 기준: 승인된 철회 정책과 테스트 계약을 문서화한다. mock 결과를 실제 로그아웃 전파 성공으로 기록하지 않는다.

## W-CON-05. staging 및 운영 pilot 검증

서비스 등록·AI Server 배포 후보 준비 후 두 조직·세 역할 실계정으로 공동 검증한다.

1. Works 로그인 → 회사 선택 → AI Console → 동일 회사·사용자 표시.
2. 승인 역할에 따른 앱·키·지식 관리 허용/거부와 타 조직 app/file/job 직접 접근 거부.
3. 코드 재사용·만료, state 누락/불일치, 미배정 회사, 정지 사용자·회사의 거절.
4. Works 회사 전환·역할 변경·탈퇴·로그아웃 이후 승인된 지연 이내 Console 접근 회수.
5. Console 로그아웃 이후 재접근 거절; Works 장애 시 신규 로그인 실패와 기존 세션 만료.
6. 브라우저 storage·DOM·네트워크 응답·로그에 client secret과 관리자 credential이 없는지 확인.
7. 기존 Works 연계서비스·AI `/v1` 호출 회귀, 검증 revision·날짜·환경·결과 기록.

인가 코드를 발급하는 callback 요청의 query string을 access log/분석 도구에 수집하지 않는다. 사용자 브라우저로 검증할 계정은 승인된 테스트 계정만 사용한다.

## AI Server 작업으로 전달할 결과

```text
Works 운영/staging web origin:
Works 운영/staging API origin:
확인한 운영 revision 및 SSO 응답 계약:
HJ_AI_CONSOLE client ID:
등록 redirect URI:
client secret 저장 위치와 전달 절차 (값은 문서/채팅 금지):
pilot 회사 UUID·표시 이름:
pilot 사용자 UUID·Works 역할·승인 Console permission:
기존 AppInfo UUID → 회사 UUID ownership 매핑:
5분 세션·철회 지연 정책 승인 여부:
즉시 회수가 필요한 경우 확정된 introspection/event 계약:
실계정 시험 결과와 남은 문제:
```

이 인계가 끝나면 AI Server에서 pilot manifest dry-run·적용, 운영 secret 설정, 지식 전체 여정 및 SSO 실계정 검증, 배포·공개 gate를 마무리한다.
