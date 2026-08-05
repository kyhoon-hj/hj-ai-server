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
| `idempotency-key` | 조건부 | 향후 변경·비동기 요청에 적용 |

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

`/admin/v1/knowledge/*`로 분리하고 지식 운영자 role을 요구합니다. 파일 등록은 비동기 job으로 전환하는 것을 목표로 합니다.

```http
POST   /admin/v1/knowledge/files
GET    /admin/v1/knowledge/files
GET    /admin/v1/knowledge/files/:id
PATCH  /admin/v1/knowledge/files/:id/policy
POST   /admin/v1/knowledge/files/:id/index
POST   /admin/v1/knowledge/files/:id/reindex
DELETE /admin/v1/knowledge/files/:id
POST   /admin/v1/knowledge/texts
```

## 플랫폼 관리자 API

`/admin/v1/apps/*`로 분리하고 외부 appkey가 아닌 관리자 인증과 권한 검사를 요구합니다.

## 외부 계약에서 제외할 현재 endpoint

- `/bedrock/config`
- `/bedrock/models`
- `/bedrock/converse`
- `/bedrock/text-response`
- `/knowledge/demo/store-seed`
- `/test-tables`

모델 ID와 system prompt는 서버 정책으로 결정하고 외부 소비자가 임의 변경하지 못하게 합니다.

## 버전 및 호환 정책

1. OpenAPI 문서를 계약의 단일 기준으로 관리합니다.
2. 필드 추가는 optional additive change로 허용합니다.
3. 필드 제거, 타입 변경, 의미 변경은 새 major API에서만 수행합니다.
4. 오류 code, 인증 방식, tenant binding은 호환 계약에 포함합니다.
5. 데모 contract suite와 generated client compile test를 CI 게이트로 사용합니다.
