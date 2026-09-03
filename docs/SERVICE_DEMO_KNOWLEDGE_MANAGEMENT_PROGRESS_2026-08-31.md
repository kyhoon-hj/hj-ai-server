# Service Demo 매장 관리자 지식관리 진행 기록

- 작성일: 2026-08-31
- 대상: `KNW-SVC-04`, `SEC-SVC-03`
- 화면: `http://127.0.0.1:11002/knowledge`

## 구현 범위

- STORE_A/STORE_B 지식 문서 목록과 검색 가능 상태 표시
- MD, CSV, PDF, DOCX, XLSX 파일 선택과 30MB 클라이언트/BFF 제한
- 한 번의 사용자 동작으로 업로드, `PUBLIC + PUBLISHED` 고객 공개 정책 적용 후 비동기 인덱싱 job 제출
- `queued`, `processing`, `completed`, `failed` 상태 폴링과 실패 작업 수동 재시도
- 재인덱싱과 기존 문서 보관
- 새 버전 업로드 → 고객 답변 확인 → 이전 버전 보관 안내
- AI Server 지식 운영자 credential의 BFF 전용 보관
- 플랫폼 인증 이메일과 매장 관리자 allowlist의 서버 측 확인
- 로컬 데모 전용 HttpOnly 관리자 세션 자동 발급(운영 환경에서는 비활성)
- 브라우저 응답에서 appcode, bucket, object key, 내부 metadata 제거

## 자동 검증

- 서비스 데모: 15 files, 49 tests PASS
- typecheck: PASS
- lint: PASS
- production build: PASS
- 무권한 관리자 API 접근: 403, AI Server 미호출
- 로컬 same-origin 관리자 세션 발급 후 문서 목록 조회: HTTP 200, 5건 확인
- 고객 공개 정책 적용 실패 시 인덱싱 중단, DRAFT/INTERNAL 문서의 고객 검색 누락 방지
- `갓 김치 종류는` 같은 짧은 상품 종류 질문을 판매 상품 검색 의도로 정규화
- 허용되지 않은 파일: 400, AI Server 미호출
- 응답에서 운영자 키와 storage 내부 경로 비노출

## 실제 AI Server E2E

STORE_A의 `store-a-policy.md` 복사본을 테스트 버전으로 사용했습니다.

1. 업로드: HTTP 201
2. 자동 인덱싱: `indexed`, chunk 1
3. 목록 표시: 새 파일 확인
4. 재인덱싱: HTTP 200
5. 보관: HTTP 200
6. 활성 목록 제외: 확인

테스트 중 생성된 복사본은 정확한 파일 ID로 보관 처리했으며 기존 fixture는 유지했습니다.

## 남은 화면 승인

- 매장 관리자 페르소나에서 지식관리 화면 진입
- 파일 선택·업로드 중 상태와 완료 안내
- STORE_A/STORE_B 전환 시 문서 목록 격리
- 재인덱싱 완료 안내
- 보관 확인과 목록 제거
- 새 버전 답변 확인 후 이전 버전을 보관하는 사용자 여정

## 단계 3 비동기 job 연결 결과

- DB 영속 job과 worker, lease 만료 작업 복구, 최대 3회 수동 재시도를 구현했습니다.
- 업로드·재인덱싱 BFF는 HTTP 202와 job ID를 반환하고 내부 오류·appcode·idempotency key를 브라우저에 노출하지 않습니다.
- 실제 XLSX 재인덱싱에서 `queued → processing → completed`, attempt 1을 확인했습니다.
- 검증 데모 `knowledge-index-job` scenario는 업로드·제출·동일 키 중복 방지·완료 조회·정리 5/5 PASS입니다.
- 다음 작업은 429/timeout/5xx와 S3/DB/embedding 장애를 주입해 retryable 오류와 영구 실패를 분류하는 것입니다.
