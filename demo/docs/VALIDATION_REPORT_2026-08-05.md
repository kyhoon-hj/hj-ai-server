# 데모·AI Server 검증 결과 — 2026-08-05

## 검증 기준

- AI Server: 로컬 Docker, `http://127.0.0.1:11000`
- Demo Console: `http://127.0.0.1:3200`
- fixture: `1.0.0`, STORE_A 2개·STORE_B 1개
- core scenario: `1.1.0`

## 결과

| 구분 | 결과 | 증거 |
|---|---:|---|
| AI Server 단위 테스트 | 30/30 PASS | Jest 11 suites |
| Demo 단위 테스트 | 5/5 PASS | Node test runner |
| setup | PASS | tenant 2개, fixture 3개 등록·인덱싱·게시 |
| tenant isolation | 6/6 PASS | 파일 상세·목록·검색 격리, 변조·회전·비활성 키 |
| core contract | 8/8 PASS | 상태·readiness·인증·correlation·Bedrock·RAG |
| cleanup | PASS | app 2개 삭제, 지식 3개 보관·chunk/S3 원본 정리 |
| cleanup 후 setup 재실행 | PASS | tenant 2개, fixture 3개 재구성 |
| mutation 안전장치 | PASS | 확인값 누락 400, 운영 대상 변경 시 403 |

## 검증 중 발견하고 수정한 결함

Bedrock 일반 답변과 Knowledge 검색·RAG 답변은 리소스를 생성하지 않지만 Nest POST 기본 상태인 `201 Created`를 반환했습니다. Swagger `ApiOkResponse` 및 공통 API 초안과 맞지 않아 해당 조회·추론 endpoint에 `200 OK`를 명시했습니다. 컨테이너 재빌드 후 core contract가 최초 5 PASS·3 FAIL에서 8 PASS·0 FAIL로 변경됐습니다.

## 남은 위험

- AppInfo 관리자 API가 아직 별도 관리자 인증 없이 노출됩니다. 다음 우선순위는 `SEC-SRV-01`, `SEC-SRV-02`입니다.
- tenant 격리는 파일 상세·목록·검색까지 자동화됐으며 최종 답변의 source 격리 검증은 남아 있습니다.
- production dependency audit에 high 5건, moderate 6건이 있어 영향 분석과 업그레이드가 필요합니다.
- 전체 lint는 기존 Knowledge parser/chunking type-safety 규칙 5건 때문에 실패합니다. 이번 변경 파일의 빌드와 테스트는 통과했습니다.
- 로컬 페이지 브라우저 자동 점검은 브라우저 URL 정책으로 실행하지 못했습니다. HTTP 동작, 정적 DOM, JavaScript 문법은 검증했습니다.

검증 후 로컬 환경은 STORE_A/STORE_B가 다시 구성된 `READY` 상태로 유지했습니다. 리포트 JSON은 `demo/reports`에 생성되며 git에는 포함하지 않습니다.
