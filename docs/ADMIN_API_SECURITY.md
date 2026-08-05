# 관리자 API 보안 계약

## 적용 범위

현재 호환 관리자 API인 `/app-info/*`는 `x-admin-key` 헤더를 요구합니다. 외부 소비자용 `appkey`는 Bedrock·Storage·Knowledge tenant 인증에만 사용되며 관리자 권한을 부여하지 않습니다.

| credential | 용도 | 허용 API |
|---|---|---|
| `x-admin-key` | 플랫폼 관리자 | `/app-info/*` |
| `appkey` | 외부 앱·tenant | `/bedrock/*`, `/storage/*`, `/knowledge/*` |

관리자 키가 없거나 잘못되면 `401 AUTHENTICATION_REQUIRED`를 반환합니다. 응답과 로그, 데모 리포트에는 credential 원문을 포함하지 않습니다.

## 환경 설정

`ADMIN_API_KEY`는 필수이며 32자 이상이어야 합니다. `APPKEY_JWT_SECRET`과 같은 값이면 서버가 시작되지 않습니다.

```text
ADMIN_API_KEY=<cryptographically-random-secret>
APPKEY_JWT_SECRET=<different-signing-secret>
```

운영에서는 저장소나 image에 값을 포함하지 않고 Secrets Manager 또는 SSM에서 주입하는 것을 목표로 합니다. 현재 로컬 Compose는 git에서 제외된 `.env`를 사용합니다.

## 배포 확인

1. 새 `ADMIN_API_KEY`를 secret store와 배포 환경에 설정합니다.
2. 새 image를 시작하고 `/health/live`, `/health/ready`를 확인합니다.
3. `/app-info` 무헤더와 오류 키 요청이 401인지 확인합니다.
4. 정상 `x-admin-key` 요청이 200인지 확인합니다.
5. 데모 core contract 12건을 실행합니다.

## 현재 한계와 다음 단계

- 현재 credential은 단일 `platform-admin` 역할입니다.
- 만료, 이중 키 무중단 회전, 관리자별 식별, 감사 이벤트가 없습니다.
- 목표 API `/admin/v1/apps/*`에서 지식 운영자와 플랫폼 관리자를 분리하고 identity 기반 RBAC를 적용합니다.
- 운영 Swagger와 내부 endpoint 노출 정책을 별도로 적용해야 합니다.
