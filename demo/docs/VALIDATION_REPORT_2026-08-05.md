# 데모·AI Server 검증 결과 — 2026-08-05

## 검증 기준

- AI Server: 로컬 Docker, `http://127.0.0.1:11000`
- Demo Console: `http://127.0.0.1:3200`
- fixture: `1.0.0`, STORE_A 2개·STORE_B 1개
- core scenario: `1.3.0`

## 결과

| 구분 | 결과 | 증거 |
|---|---:|---|
| AI Server 단위 테스트 | 63/63 PASS | Jest 16 suites, appkey·관리자 이중 키 수명주기 포함 |
| AI Server HTTP e2e | 14/14 PASS | AppInfo·지식 운영자·Bedrock 관리자 RBAC와 감사 조회 포함 |
| Demo 단위 테스트 | 5/5 PASS | Node test runner |
| setup | PASS | tenant 2개, fixture 3개 등록·인덱싱·게시 |
| tenant isolation | 8/8 PASS | 파일 상세·목록·검색·양방향 Answer source 격리, 변조·회전·비활성 키 |
| credential lifecycle | 4/4 PASS | JWT 만료, 2초 grace의 신·구 키 허용, 종료 뒤 이전 키 401, 회전 감사 이벤트 |
| role-based access control | 6/6 PASS | 플랫폼 관리자·지식 운영자·외부 appkey 경계 |
| core contract | 14/14 PASS | 상태·인증·correlation·Bedrock·RAG·legacy 차단 |
| HTTP exposure | 4/4 PASS | Swagger 404, CORS 허용·비허용 Origin과 preflight |
| internal API exposure | 8/8 PASS | legacy 지식 쓰기·Bedrock 조회·test-tables 차단과 관리자 대체 경로 |
| cleanup | PASS | app 2개 삭제, 지식 3개 보관·chunk/S3 원본 정리 |
| cleanup 후 setup 재실행 | PASS | tenant 2개, fixture 3개 재구성 |
| mutation 안전장치 | PASS | 확인값 누락 400, 운영 대상 변경 시 403 |

## 검증 중 발견하고 수정한 결함

Bedrock 일반 답변과 Knowledge 검색·RAG 답변은 리소스를 생성하지 않지만 Nest POST 기본 상태인 `201 Created`를 반환했습니다. Swagger `ApiOkResponse` 및 공통 API 초안과 맞지 않아 해당 조회·추론 endpoint에 `200 OK`를 명시했습니다. 컨테이너 재빌드 후 core contract가 최초 5 PASS·3 FAIL에서 8 PASS·0 FAIL로 변경됐습니다.

AppInfo 전체 API가 무인증으로 노출되어 외부 appkey와 분리된 `x-admin-key` guard를 적용했습니다. `ADMIN_API_KEY`는 시작 시 필수이며 32자 이상, `APPKEY_JWT_SECRET`과 다른 값이어야 합니다. 해당 단계에서 core contract 12/12를 확인했으며 현재 확장 suite는 14/14 PASS입니다.

`KNOWLEDGE_OPERATOR_API_KEY`와 `/admin/v1/knowledge/apps/:appId/*`를 추가했습니다. 지식 운영자는 AppInfo에 403, 지식 운영 API에는 200이며 플랫폼 관리자는 양쪽 모두 접근할 수 있습니다. 외부 appkey와 무인증 요청은 지식 운영 API에서 401입니다. cleanup 후 app이 없는 상태에서 setup이 `existing.id`를 읽던 결함도 재현 후 수정했습니다.

STORE_A와 STORE_B가 서로의 전용 정책을 질문하는 실제 Bedrock Answer 호출을 추가했습니다. 두 방향 모두 `sources`가 요청 app의 fixture file ID만 포함하고 상대 tenant file ID는 0건임을 확인했습니다. 각 호출은 처리량과 비용 경계를 명확히 하기 위해 `maxTokens=256`을 지정했습니다.

appkey 서명 로직에서 `JWT_SECRET` 및 고정 문자열 fallback을 제거했습니다. 이제 `APPKEY_JWT_SECRET`이 없으면 appkey를 발급하지 않고 즉시 실패하며, 운영 환경 검증과 서비스 단위 계약 양쪽에서 전용 secret 사용을 강제합니다.

CORS는 `CORS_ALLOWED_ORIGINS`의 정확한 http(s) Origin에만 응답하도록 변경하고 wildcard·path 포함 URL을 startup에서 거절합니다. 운영 Swagger는 `SWAGGER_ENABLED=true`를 명시하지 않으면 생성하지 않습니다. 새 운영 이미지에서 Swagger 404, 비허용 Origin 차단, `http://127.0.0.1:3200` 허용을 실제 HTTP 응답으로 4/4 확인했습니다.

Legacy Bedrock config/models와 appkey 기반 지식 쓰기, demo seed, test-tables를 명시적 호환 플래그가 없으면 404로 차단했습니다. Bedrock 운영 조회는 platform-admin 전용 `/admin/v1/bedrock/*`로 이동했습니다. Swagger를 일시 활성화한 검증 환경에서 제외 대상 path 0건, 필수 관리자 path 누락 0건을 확인한 뒤 다시 비활성화했습니다.

appkey에 JWT `exp`와 DB 만료 시각을 추가하고 기본 90일 수명, 최대 86,400초의 제한된 이전 키 grace를 적용했습니다. 관리자는 primary/previous 키와 종료 시각으로 무중단 교체할 수 있습니다. 발급·회전·관리자 접근·인증 실패·권한 거부는 PostgreSQL 감사 이벤트로 기록하며 platform-admin 전용 조회 API는 credential 원문과 hash를 반환하지 않습니다. migration 적용과 컨테이너 재빌드 후 수명주기 4/4 및 전체 회귀 시나리오를 다시 통과했습니다.

## 남은 위험

- Legacy 경로 구현과 일시 활성화 플래그는 호환 진단을 위해 남아 있으므로 사용 관찰 후 코드와 플래그를 최종 제거해야 합니다.
- 관리자·운영자 previous 키 종료와 무중단 교체는 지원하지만 정적 키에 자체 만료 claim이 없고 사용자별 identity를 식별하지 못합니다.
- 감사 이벤트의 retention·중앙 보관·위변조 방지와 만료 previous appkey hash 정리 작업은 남아 있습니다.
- tenant 데이터 경계는 파일·목록·검색·Answer source까지 자동화됐지만 source 내용의 정답률 평가는 별도 품질 dataset으로 확장해야 합니다.
- production dependency audit에 high 5건, moderate 6건이 있어 영향 분석과 업그레이드가 필요합니다.
- 전체 lint는 기존 Knowledge parser/chunking type-safety 규칙 5건 때문에 실패합니다. 이번 변경 파일의 빌드와 테스트는 통과했습니다.
- 로컬 데모 페이지는 인앱 브라우저에서 렌더링·버튼 실행·콘솔 오류를 점검했습니다.
- 공개 CDN/reverse proxy에는 이번 commit을 배포하지 않았으므로 외부 도메인의 CORS·Swagger 상태는 별도 배포 검증이 필요합니다.

검증 후 로컬 환경은 STORE_A/STORE_B가 다시 구성된 `READY` 상태로 유지했습니다. 리포트 JSON은 `demo/reports`에 생성되며 git에는 포함하지 않습니다.
