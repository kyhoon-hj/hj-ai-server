# Service Demo S0 검증 보고서

- 검증일: 2026-08-30
- 구현 commit: `e9838d9`
- fixture version: `svc-s0-v1`
- 서비스 데모: `http://127.0.0.1:11002`
- 비공개 배포: `https://hj-mart-assist.kyhoon-hj.chatgpt.site`
- AI Server target: `http://127.0.0.1:11000`

## 완료 범위

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| `ENV-SVC-01` 독립 앱과 실행 설정 | PASS | vinext/React 앱, Sites 설정, 11002 strict port |
| `ENV-SVC-02` persona와 여정 | PASS | 고객·상담원·매장 관리자, persona별 대표 여정 2개 |
| `ENV-SVC-03` fixture와 화면 상태 | PASS | 가상 ID 기반 상품·정책·문의, loading·empty·error·permission 상태 |
| `ENV-SVC-04` 공통 API 계층 | PASS | UUID correlation ID, timeout, 구조화 오류, retryable 분류, `/api/health` BFF |

## 자동 검증

| 명령 | 결과 |
| --- | --- |
| `npm test` | 3 files, 9 tests PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm audit --omit=dev` | 취약점 0건 |

## HTTP 확인

- `/`는 200을 반환하고 `HJ Mart Assist` 화면을 렌더링했습니다.
- AI Server가 정지된 조건에서 `/api/health`는 503 `UPSTREAM_UNREACHABLE`을 반환했습니다.
- 응답 본문의 `requestId`와 `x-correlation-id` 응답 헤더가 동일한 UUID임을 확인했습니다.
- 브라우저에는 AI Server URL 외 관리자·운영자 credential을 전달하지 않습니다.

이 결과로 서비스 데모가 로컬 AI Server를 대상으로 실행되고 준비 상태와 연결 오류를 사용자에게 구분해 표시한다는 S0 Exit Gate를 충족합니다.
