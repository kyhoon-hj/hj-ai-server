# 데모·AI Server 검증 결과 — 2026-08-05

## 검증 기준

- AI Server: 로컬 Docker, `http://127.0.0.1:11000`
- Demo Console: `http://127.0.0.1:3200`
- fixture: `1.0.0`, STORE_A 2개·STORE_B 1개
- core scenario: `1.2.0`

## 결과

| 구분 | 결과 | 증거 |
|---|---:|---|
| AI Server 단위 테스트 | 38/38 PASS | Jest 12 suites |
| AI Server HTTP e2e | 9/9 PASS | AppInfo·지식 운영자 RBAC 포함 |
| Demo 단위 테스트 | 5/5 PASS | Node test runner |
| setup | PASS | tenant 2개, fixture 3개 등록·인덱싱·게시 |
| tenant isolation | 8/8 PASS | 파일 상세·목록·검색·양방향 Answer source 격리, 변조·회전·비활성 키 |
| role-based access control | 6/6 PASS | 플랫폼 관리자·지식 운영자·외부 appkey 경계 |
| core contract | 12/12 PASS | 상태·관리자/appkey 인증·권한 분리·correlation·Bedrock·RAG |
| cleanup | PASS | app 2개 삭제, 지식 3개 보관·chunk/S3 원본 정리 |
| cleanup 후 setup 재실행 | PASS | tenant 2개, fixture 3개 재구성 |
| mutation 안전장치 | PASS | 확인값 누락 400, 운영 대상 변경 시 403 |

## 검증 중 발견하고 수정한 결함

Bedrock 일반 답변과 Knowledge 검색·RAG 답변은 리소스를 생성하지 않지만 Nest POST 기본 상태인 `201 Created`를 반환했습니다. Swagger `ApiOkResponse` 및 공통 API 초안과 맞지 않아 해당 조회·추론 endpoint에 `200 OK`를 명시했습니다. 컨테이너 재빌드 후 core contract가 최초 5 PASS·3 FAIL에서 8 PASS·0 FAIL로 변경됐습니다.

AppInfo 전체 API가 무인증으로 노출되어 외부 appkey와 분리된 `x-admin-key` guard를 적용했습니다. `ADMIN_API_KEY`는 시작 시 필수이며 32자 이상, `APPKEY_JWT_SECRET`과 다른 값이어야 합니다. 로컬 컨테이너에서 무인증 401·오류 관리자 키 401·appkey 단독 401·정상 관리자 키 200을 확인했고 core contract는 12/12 PASS입니다.

`KNOWLEDGE_OPERATOR_API_KEY`와 `/admin/v1/knowledge/apps/:appId/*`를 추가했습니다. 지식 운영자는 AppInfo에 403, 지식 운영 API에는 200이며 플랫폼 관리자는 양쪽 모두 접근할 수 있습니다. 외부 appkey와 무인증 요청은 지식 운영 API에서 401입니다. cleanup 후 app이 없는 상태에서 setup이 `existing.id`를 읽던 결함도 재현 후 수정했습니다.

STORE_A와 STORE_B가 서로의 전용 정책을 질문하는 실제 Bedrock Answer 호출을 추가했습니다. 두 방향 모두 `sources`가 요청 app의 fixture file ID만 포함하고 상대 tenant file ID는 0건임을 확인했습니다. 각 호출은 처리량과 비용 경계를 명확히 하기 위해 `maxTokens=256`을 지정했습니다.

appkey 서명 로직에서 `JWT_SECRET` 및 고정 문자열 fallback을 제거했습니다. 이제 `APPKEY_JWT_SECRET`이 없으면 appkey를 발급하지 않고 즉시 실패하며, 운영 환경 검증과 서비스 단위 계약 양쪽에서 전용 secret 사용을 강제합니다.

## 남은 위험

- 신규 관리자 경계는 역할별로 분리됐지만 기존 `/knowledge/files|texts|index|policy` appkey 호환 경로가 남아 있어 공지·관찰 기간 후 폐기해야 합니다.
- 관리자·운영자 키 만료, 사용자별 식별, 감사 이벤트와 무중단 회전은 남아 있습니다.
- tenant 데이터 경계는 파일·목록·검색·Answer source까지 자동화됐지만 source 내용의 정답률 평가는 별도 품질 dataset으로 확장해야 합니다.
- production dependency audit에 high 5건, moderate 6건이 있어 영향 분석과 업그레이드가 필요합니다.
- 전체 lint는 기존 Knowledge parser/chunking type-safety 규칙 5건 때문에 실패합니다. 이번 변경 파일의 빌드와 테스트는 통과했습니다.
- 로컬 페이지 브라우저 자동 점검은 브라우저 URL 정책으로 실행하지 못했습니다. HTTP 동작, 정적 DOM, JavaScript 문법은 검증했습니다.

검증 후 로컬 환경은 STORE_A/STORE_B가 다시 구성된 `READY` 상태로 유지했습니다. 리포트 JSON은 `demo/reports`에 생성되며 git에는 포함하지 않습니다.
