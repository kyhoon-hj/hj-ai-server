# Credential 수명주기와 감사 운영 가이드

## 적용 범위

이 문서는 외부 소비자 `appkey`와 정적 관리자 credential의 만료·교체·감사 계약을 정의합니다. 현재 관리자 credential은 환경변수 기반 호환 단계이며, 사용자별 identity 기반 인증으로 전환하기 전까지 이 절차를 운영 기준으로 사용합니다.

## 외부 소비자 appkey

- 신규 발급 기본 유효기간은 `APPKEY_TTL_DAYS`이며 기본값은 90일입니다.
- 신규 발급 JWT의 `exp`와 DB의 `appkey_expires_at`을 모두 확인합니다. 어느 한쪽이라도 만료되면 `401`입니다. migration 이전의 `exp` 없는 legacy 키는 backfill된 DB 만료 시각까지만 허용하며 다음 회전 때 신규 형식으로 전환합니다.
- 원문 appkey는 생성·회전 응답에서 한 번만 전달하고 DB에는 SHA-256 hash만 보관합니다.
- 회전 기본값은 grace period 0초이므로 이전 키가 즉시 폐기됩니다.
- grace period는 `APPKEY_MAX_ROTATION_GRACE_SECONDS` 이하에서만 허용하며 기본 상한은 86,400초입니다.
- 이전 키는 grace period 동안에만 허용됩니다. 만료 뒤 hash가 DB에 남아 있더라도 인증에는 사용할 수 없습니다.

발급 시 `appkeyTtlDays`를 생략하면 서버 기본값을 사용합니다. 회전은 플랫폼 관리자 credential로 호출합니다.

```http
POST /app-info/{appId}/appkey
x-admin-key: <platform-admin credential>
content-type: application/json

{
  "gracePeriodSeconds": 300,
  "ttlDays": 90
}
```

응답의 `appkey`, `appkeyExpiresAt`, `appkeyRotatedAt`, `previousAppkeyValidUntil`을 배포 시스템에 안전하게 전달합니다. appkey 원문은 이후 조회 응답에서 다시 반환되지 않습니다.

## appkey 무중단 교체 절차

1. 관리자 API에서 새 키를 필요한 grace period와 함께 발급합니다.
2. 응답의 만료 시각과 이전 키 허용 종료 시각을 기록합니다.
3. 외부 앱 secret을 새 키로 갱신하고 새 키 호출이 성공하는지 확인합니다.
4. grace period 안에 모든 인스턴스의 이전 키 사용을 종료합니다.
5. grace period 종료 후 이전 키가 `401`, 새 키가 `200`인지 확인합니다.
6. `APPKEY_ROTATED` 감사 이벤트의 appId, 종료 시각, 요청 ID를 확인합니다.

배포 시간이 예측되지 않으면 무제한 grace를 사용하지 않고 짧은 기간으로 재회전합니다. 회전 응답을 잃어버린 경우 원문을 복구할 수 없으므로 다시 회전합니다.

## 관리자·지식 운영자 credential 무중단 교체

각 역할은 현재 키와 이전 키 한 개를 동시에 받을 수 있습니다.

```text
ADMIN_API_KEY=<new-primary-key>
ADMIN_API_KEY_PREVIOUS=<old-key>
ADMIN_API_KEY_PREVIOUS_VALID_UNTIL=2026-08-06T00:00:00.000Z

KNOWLEDGE_OPERATOR_API_KEY=<new-primary-key>
KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS=<old-key>
KNOWLEDGE_OPERATOR_API_KEY_PREVIOUS_VALID_UNTIL=2026-08-06T00:00:00.000Z
```

교체 순서는 다음과 같습니다.

1. 새 키를 primary에, 기존 키를 previous에 설정하고 UTC 종료 시각을 지정합니다.
2. 새 설정으로 서버를 배포하고 live/readiness를 확인합니다.
3. 관리자 클라이언트를 새 키로 변경하고 정상 접근을 확인합니다.
4. 종료 시각 뒤 기존 키가 `401`인지 확인합니다.
5. previous 값과 종료 시각을 함께 제거하고 다시 배포합니다.

previous 키와 종료 시각은 반드시 한 쌍이어야 하며, 모든 관리자 키와 appkey 서명 secret은 서로 달라야 합니다. 조건을 만족하지 않으면 서버가 시작되지 않습니다. 현재 값은 정적 환경변수이므로 관리자 키 교체에는 배포가 필요합니다.

## 감사 이벤트

플랫폼 관리자만 다음 API를 조회할 수 있습니다.

```http
GET /admin/v1/security/audit-events?eventType=APPKEY_ROTATED&appId={uuid}&limit=50
x-admin-key: <platform-admin credential>
```

현재 기록하는 주요 이벤트는 다음과 같습니다.

| 이벤트 | 의미 |
|---|---|
| `APPKEY_ISSUED` | app 생성과 함께 appkey 발급 |
| `APPKEY_ROTATED` | appkey 회전 및 grace 설정 |
| `ADMIN_API_ACCESSED` | 허용된 관리자 API 접근 |
| `ADMIN_AUTHENTICATION_FAILED` | 관리자 credential 누락·오류·만료 |
| `ADMIN_AUTHORIZATION_DENIED` | 인증된 역할의 권한 부족 |

감사 데이터에는 역할, primary/previous credential slot, appId/appcode, requestId, method, path와 비민감 metadata를 저장합니다. credential 원문과 appkey hash는 저장하거나 응답하지 않습니다. 감사 기록 실패는 본 요청을 중단하지 않고 서버 로그에 오류를 남기는 best-effort 방식입니다.

## 배포와 검증

DB migration `20260805090000_add_security_credential_lifecycle`을 애플리케이션 시작 전에 적용합니다. 기존 appkey에는 migration 실행 시점을 기준으로 90일 만료 시각을 backfill합니다.

권장 검증 순서는 다음과 같습니다.

1. `npx prisma migrate status`
2. unit/e2e suite
3. 데모 `credential 수명주기 검증` 4/4
4. tenant isolation 8/8, RBAC 6/6, core contract 14/14
5. 감사 조회 응답에 credential 원문·hash가 없는지 확인

## 남은 운영 과제

- 정적 관리자 키를 OIDC/IAM 등 사용자별 identity로 교체하고 actorId를 실제 주체에 연결해야 합니다.
- 감사 로그의 보존기간, 접근 권한, 내보내기와 위변조 방지 정책이 필요합니다.
- 만료된 previous appkey hash를 주기적으로 제거하는 정리 작업이 필요합니다.
- 관리자 credential은 자체 `exp`가 없으므로 previous 종료 시각과 배포 절차로만 수명주기를 제어합니다.
