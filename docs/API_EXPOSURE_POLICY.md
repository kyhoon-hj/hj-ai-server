# 운영 API 노출 정책

## 목적

외부 앱용 조회·추론 API, 지식 운영 API, 플랫폼 관리자 API와 개발·호환 endpoint를 분리합니다. 운영 제외 endpoint는 기본적으로 등록된 route처럼 동작하지 않도록 `404 Not Found`를 반환하고 Swagger에서도 제외합니다.

## 현재 경계

| 영역 | 경로 | credential | 운영 기본값 |
|---|---|---|---|
| 외부 소비자 | `/knowledge/search`, `/knowledge/answers`, `/knowledge/rag-response`, `/bedrock/general-answers` | `appkey` | 허용 |
| tenant 지식 읽기 | `GET /knowledge/files*` | `appkey` | 허용 |
| 지식 운영 | `/admin/v1/knowledge/apps/:appId/*` | platform-admin 또는 knowledge-operator | 허용 |
| Bedrock 운영 조회 | `/admin/v1/bedrock/config`, `/admin/v1/bedrock/models` | platform-admin | 허용 |
| Legacy Bedrock 조회 | `/bedrock/config`, `/bedrock/models` | `appkey` | 404 |
| Legacy 지식 쓰기 | `/knowledge/files` POST·PATCH·DELETE, `/knowledge/texts`, index/reindex, demo seed | `appkey` | 404 |
| 개발 테이블 | `/test-tables*` | platform-admin | 404 |

Legacy 지식 쓰기는 파일 목록·상세 조회와 혼동하지 않도록 HTTP method 단위로 차단합니다. 데모 setup/cleanup은 관리자 지식 운영 API를 사용하므로 차단 상태에서도 정상 동작합니다.

## 호환 플래그

세 플래그는 모두 기본값이 `false`이며 `true` 또는 `false` 이외 값은 startup에서 거절합니다.

```dotenv
ENABLE_TEST_TABLE_API=false
ENABLE_LEGACY_BEDROCK_INSPECTION_API=false
ENABLE_LEGACY_KNOWLEDGE_WRITE_API=false
```

일시 활성화는 로컬 호환 진단에서만 사용합니다. 운영에서 활성화하려면 사용 주체·종료 일시·호출 관찰 계획을 배포 기록에 남겨야 합니다. `test-tables`는 활성화하더라도 platform-admin credential이 필요합니다.

## Swagger 정책

Swagger를 명시적으로 활성화해도 운영 제외 endpoint는 OpenAPI paths에 포함하지 않습니다. 플랫폼 관리자용 Bedrock 경로와 지식 운영자 경로만 관리자 계약으로 표시합니다.

## 배포 검증

1. 세 호환 플래그가 `false`인지 확인합니다.
2. 데모 `운영 API 경계 검증` 8/8을 실행합니다.
3. core contract 14/14, SKIP 0을 확인합니다.
4. Swagger를 격리된 검증 환경에서 일시 활성화해 legacy/test paths 0건을 확인합니다.
5. Swagger를 다시 비활성화하고 UI·JSON 경로가 404인지 확인합니다.
6. 공개 CDN/reverse proxy에서도 동일한 경계를 smoke test합니다.
