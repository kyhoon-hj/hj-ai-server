# 외부 앱 공통 API 명세 초안

## 목적

외부 앱에 내부 Bedrock·S3·지식 운영 세부사항을 노출하지 않고 안정적인 소비자 계약을 제공합니다. 현재 endpoint를 즉시 제거하지 않고 `/v1` 계약을 추가한 뒤 호환 기간을 운영합니다.

## 외부 소비자 API

```http
POST /v1/answers
POST /v1/general-answers
POST /v1/search          # 원시 검색 결과가 필요한 소비자만
GET  /health/live
GET  /health/ready
```

세 POST endpoint는 리소스 생성 API가 아니라 동기 조회·추론 API이므로 성공 시 모두 `200 OK`를 반환합니다. 현재 호환 endpoint인 `/bedrock/general-answers`, `/knowledge/search`, `/knowledge/rag-response`, `/knowledge/answers`도 같은 상태 코드를 사용합니다.

### 공통 요청 헤더

| 헤더 | 필수 | 설명 |
|---|---:|---|
| `appkey` | O | 서버 간 소비자 키 |
| `x-correlation-id` |  | 호출자가 생성한 UUID. 없으면 서버 생성 |
| `content-type` | POST | `application/json` |
| `idempotency-key` | 조건부 | 지식 비동기 인덱싱·재인덱싱 요청의 중복 제출 방지에 적용 |

appkey는 유효기간이 있는 JWT이며 서버는 서명, JWT `exp`, DB 만료 시각, app 상태를 모두 검사합니다. 만료·폐기·변조 키는 `401 AUTHENTICATION_REQUIRED`입니다. 키 회전 중 이전 키는 관리자가 지정한 제한된 grace period에만 허용되며, 외부 앱은 응답이나 로그에 키 원문을 기록하지 않아야 합니다.

### 공통 오류

```json
{
  "statusCode": 429,
  "message": "요청 한도를 초과했습니다.",
  "error": "Too Many Requests",
  "code": "RATE_LIMITED",
  "requestId": "uuid"
}
```

오류 `code`는 외부 계약으로 고정하고 메시지 문구는 계약 대상으로 삼지 않습니다.

## 지식 운영 API

`/admin/v1/knowledge/apps/:appId/*`로 분리하고 지식 운영자 또는 플랫폼 관리자 role을 요구합니다. `appId`로 대상 tenant를 명시하며 파일 인덱싱은 `/files/:id/index-jobs`, `/index-jobs/:jobId` 계약으로 비동기 처리합니다.

```http
POST   /admin/v1/knowledge/apps/:appId/files
GET    /admin/v1/knowledge/apps/:appId/files
GET    /admin/v1/knowledge/apps/:appId/files/:id
PATCH  /admin/v1/knowledge/apps/:appId/files/:id/policy
POST   /admin/v1/knowledge/apps/:appId/files/:id/index
POST   /admin/v1/knowledge/apps/:appId/files/:id/reindex
DELETE /admin/v1/knowledge/apps/:appId/files/:id
POST   /admin/v1/knowledge/apps/:appId/texts
```

## 플랫폼 관리자 API

`/admin/v1/apps/*`로 분리하고 외부 appkey가 아닌 관리자 인증과 권한 검사를 요구합니다.

현재 호환 API인 `/app-info/*`는 `x-admin-key` 전용 credential을 필수로 요구합니다. appkey는 AppInfo 관리 권한을 부여하지 않습니다. 목표 `/admin/v1/apps/*`에서는 role 기반 관리자 인증으로 교체하며 현재 정적 키는 호환 전환 단계로만 사용합니다.

Bedrock 설정·모델 조회는 `/admin/v1/bedrock/config`, `/admin/v1/bedrock/models`로 분리하며 platform-admin만 접근할 수 있습니다.

현재 appkey 발급·회전 호환 계약은 다음과 같습니다.

```http
POST /app-info/{appId}/appkey
x-admin-key: <platform-admin credential>
content-type: application/json

{ "gracePeriodSeconds": 300, "ttlDays": 90 }
```

새 appkey 원문은 생성·회전 응답에서만 반환합니다. 이후 조회에는 `appkeyExpiresAt`, `appkeyRotatedAt`, `previousAppkeyValidUntil`만 노출합니다. 관리자 보안 이벤트는 platform-admin 전용 `GET /admin/v1/security/audit-events`에서 조회합니다.

## 외부 계약에서 제외할 현재 endpoint

- `/bedrock/config`
- `/bedrock/models`
- `/bedrock/converse`
- `/bedrock/text-response`
- `/knowledge/demo/store-seed`
- `/test-tables`

위 config/models, demo seed, test-tables와 legacy 지식 쓰기 endpoint는 운영 기본값에서 404이며 Swagger에도 포함하지 않습니다. 제한된 호환 시험에서만 명시적 환경 플래그로 일시 활성화합니다.

모델 ID와 system prompt는 서버 정책으로 결정하고 외부 소비자가 임의 변경하지 못하게 합니다.

## 버전 및 호환 정책

1. OpenAPI 문서를 계약의 단일 기준으로 관리합니다.
2. 필드 추가는 optional additive change로 허용합니다.
3. 필드 제거, 타입 변경, 의미 변경은 새 major API에서만 수행합니다.
4. 오류 code, 인증 방식, tenant binding은 호환 계약에 포함합니다.
5. 데모 contract suite와 generated client compile test를 CI 게이트로 사용합니다.
