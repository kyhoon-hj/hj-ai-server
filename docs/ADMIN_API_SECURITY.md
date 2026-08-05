# 관리자 API 보안 계약

## 적용 범위

현재 호환 관리자 API인 `/app-info/*`는 `x-admin-key` 헤더를 요구합니다. 외부 소비자용 `appkey`는 Bedrock·Storage·Knowledge tenant 인증에만 사용되며 관리자 권한을 부여하지 않습니다.

| credential | 용도 | 허용 API |
|---|---|---|
| `x-admin-key` (`ADMIN_API_KEY`) | 플랫폼 관리자 | `/app-info/*`, `/admin/v1/knowledge/*`, `/admin/v1/bedrock/*` |
| `x-admin-key` (`KNOWLEDGE_OPERATOR_API_KEY`) | 지식 운영자 | `/admin/v1/knowledge/*` |
| `appkey` | 외부 앱·tenant | `/bedrock/*`, `/storage/*`, `/knowledge/*` |

관리자 키가 없거나 잘못되면 `401 AUTHENTICATION_REQUIRED`를 반환합니다. 응답과 로그, 데모 리포트에는 credential 원문을 포함하지 않습니다.

## 환경 설정

`ADMIN_API_KEY`와 `KNOWLEDGE_OPERATOR_API_KEY`는 필수이며 32자 이상이어야 합니다. 모든 관리자 credential과 `APPKEY_JWT_SECRET` 중 같은 값이 있으면 서버가 시작되지 않습니다. 무중단 교체 중에는 역할별 previous 키와 UTC 종료 시각을 한 쌍으로 설정할 수 있습니다.

```text
ADMIN_API_KEY=<cryptographically-random-secret>
KNOWLEDGE_OPERATOR_API_KEY=<different-operator-secret>
APPKEY_JWT_SECRET=<different-signing-secret>
ADMIN_API_KEY_PREVIOUS=<previous-admin-secret>
ADMIN_API_KEY_PREVIOUS_VALID_UNTIL=<ISO-8601 UTC timestamp>
```

운영에서는 저장소나 image에 값을 포함하지 않고 Secrets Manager 또는 SSM에서 주입하는 것을 목표로 합니다. 현재 로컬 Compose는 git에서 제외된 `.env`를 사용합니다.

## 배포 확인

1. 새 `ADMIN_API_KEY`를 primary, 기존 값을 `ADMIN_API_KEY_PREVIOUS`로 설정하고 previous 종료 시각을 지정합니다.
2. 새 image를 시작하고 `/health/live`, `/health/ready`를 확인합니다.
3. 이전 키와 새 키가 교체 기간에 모두 허용되는지 확인합니다.
4. 클라이언트를 새 키로 이전하고 종료 시각 뒤 이전 키가 401인지 확인합니다.
5. previous 설정을 제거해 다시 배포합니다.
6. 데모 core contract 14건, 운영 API 경계 8건, credential 수명주기 4건을 실행합니다.

허용·거부·appkey 발급/회전 이벤트는 platform-admin 전용 `GET /admin/v1/security/audit-events`에서 확인합니다. credential 원문과 hash는 감사 응답에 포함하지 않습니다. 상세 절차는 [Credential 수명주기와 감사 운영 가이드](CREDENTIAL_LIFECYCLE_AND_AUDIT.md)를 따릅니다.

## 현재 한계와 다음 단계

- 현재 credential은 `platform-admin`, `knowledge-operator` 두 역할입니다.
- 역할별 이전 키 한 개와 종료 시각을 이용한 무중단 회전은 지원하지만 정적 키 자체에 만료 claim은 없습니다.
- 감사 이벤트의 actor는 현재 역할과 credential slot까지만 식별하며 관리자 개인 identity를 구분하지 않습니다.
- 목표 API `/admin/v1/apps/*`로 AppInfo 호환 경로를 이전하고 identity 기반 RBAC와 tenant별 운영자 scope를 적용합니다.
- Legacy·개발 endpoint의 기본 차단 정책은 [운영 API 노출 정책](API_EXPOSURE_POLICY.md)을 따릅니다.
