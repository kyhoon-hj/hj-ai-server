# Service Demo S1 고객 채팅 진행 기록

- 작성일: 2026-08-30
- 대상: `KNW-SVC-01~03`
- 공개 계약: `POST /v1/knowledge/answers`

## 구현 결과

| 항목 | 상태 | 결과 |
| --- | --- | --- |
| 고객 채팅과 추천 질문 | 구현 완료 | 질문 입력·Enter 전송·loading·오류·대화 상태 |
| tenant context | 구현 완료 | `STORE_A`, `STORE_B` allowlist와 매장 전환 시 대화 초기화 |
| BFF credential 경계 | 구현 완료 | tenant별 appkey를 서버 환경변수에서만 읽고 브라우저에 비노출 |
| 근거 source | 구현 완료 | 파일명·페이지·상품코드·관련도만 허용하고 내부 key·content·metadata 제거 |
| strict no-answer | 구현 완료 | source가 없으면 `answerable=false`로 강제하고 상담원 검토를 안내 |
| 상담원 검토 요청 | 부분 완료 | 현재 세션 접수 상태 구현, 영구 검토함 저장은 후속 단계 |

## 자동 검증

- 서비스 데모 단위·BFF 계약: 5 files, 15 tests PASS
- typecheck: PASS
- lint: PASS
- build: PASS
- `/chat`: HTTP 200
- appkey 미설정 `/api/answers`: 503 `SERVICE_DEMO_NOT_CONFIGURED`, 본문과 헤더 correlation ID 일치
- 응답에 appkey, S3 key, 허용하지 않은 source metadata가 포함되지 않음을 검증

## 남은 완료 조건

현재 Docker Desktop과 로컬 AI Server가 실행되지 않고 tenant appkey도 설정되지 않아 실제 fixture를 사용한 질의 E2E는 수행하지 못했습니다. 다음 검증에서는 AI Server와 STORE_A/STORE_B fixture를 준비한 뒤 환불·교환·운영시간·상품 문의의 answer/source/no-answer를 실제 응답으로 대조합니다.
