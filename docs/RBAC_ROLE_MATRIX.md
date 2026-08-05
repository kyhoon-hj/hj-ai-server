# API 역할·권한 매트릭스

## 역할

| 역할 | credential | 책임 |
|---|---|---|
| 플랫폼 관리자 | `ADMIN_API_KEY` | 앱 생성·수정·삭제, appkey 회전, 모든 지식 운영 |
| 지식 운영자 | `KNOWLEDGE_OPERATOR_API_KEY` | 지정 app의 지식 업로드·조회·정책·인덱싱·보관 |
| 외부 소비자 | AppInfo에서 발급한 `appkey` | 자신의 tenant에서 검색·답변·일반 답변 소비 |

## 목표 권한

| API 영역 | 플랫폼 관리자 | 지식 운영자 | 외부 소비자 |
|---|:---:|:---:|:---:|
| `/app-info/*` | 허용 | 403 | 401 |
| `/admin/v1/knowledge/apps/:appId/*` | 허용 | 허용 | 401 |
| `/knowledge/search`, `/knowledge/rag-response`, `/knowledge/answers` | appkey 사용 | appkey 사용 | 자신의 tenant만 허용 |
| `/bedrock/general-answers` | appkey 사용 | appkey 사용 | 허용 |
| health | 허용 | 허용 | 허용 |

지식 운영자는 appId를 명시해 여러 tenant를 운영하는 전역 역할입니다. tenant별 운영자 제한은 identity 기반 RBAC 단계에서 별도 scope로 추가합니다.

## 호환 전환 상태

신규 지식 운영 API와 역할 검증은 적용됐습니다. 기존 `/knowledge/files`, `/knowledge/texts`, `/knowledge/files/:id/index`, policy·delete 경로는 appkey 호환을 위해 아직 남아 있습니다. 호출 현황을 확인하고 운영자 API로 소비자를 이전한 뒤 제거해야 외부 소비자를 완전한 읽기·답변 전용 역할로 확정할 수 있습니다.

데모 RBAC 시나리오는 지식 운영자의 AppInfo 403, 플랫폼 관리자·지식 운영자의 지식 운영 200, appkey·무인증 지식 운영 401을 검증합니다.
