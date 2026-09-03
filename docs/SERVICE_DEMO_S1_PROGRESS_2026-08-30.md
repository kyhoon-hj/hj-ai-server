# Service Demo S1 고객 채팅 진행 기록

- 작성일: 2026-08-30
- 대상: `KNW-SVC-01~03`
- 공개 계약: `POST /knowledge/answers` (`API_GLOBAL_PREFIX` 사용 시 prefix 포함)

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

- 서비스 데모 단위·BFF 계약: 7 files, 20 tests PASS
- typecheck: PASS
- lint: PASS
- build: PASS
- `/chat`: HTTP 200
- appkey 미설정 `/api/answers`: 503 `SERVICE_DEMO_NOT_CONFIGURED`, 본문과 헤더 correlation ID 일치
- 응답에 appkey, S3 key, 허용하지 않은 source metadata가 포함되지 않음을 검증

## 실제 fixture E2E (2026-08-31)

- AI Server readiness와 서비스 데모 `/chat`: HTTP 200
- STORE_A 운영시간: 오전 10시~오후 10시와 `store-a-policy.md` 확인
- STORE_A 상품: 1층 A-04, 재고 18개, 5,000원과 `store-a-products.csv` 확인
- STORE_A 환불: 일반 상품 7일 정책과 정책·반품 가이드 source 확인
- STORE_A 미등록 재입고 일정: `answerable=false`, source 없음 확인
- STORE_B 교환: 14일 정책과 `store-b-policy.md` 확인
- STORE_A 문맥의 STORE_B 질문에서 STORE_B source가 노출되지 않음을 확인

재현 절차와 수동 합격 기준은 [서비스 데모 로컬 테스트 가이드](SERVICE_DEMO_TEST_GUIDE.md)를 따릅니다.
