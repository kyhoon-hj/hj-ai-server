# 비동기 인덱싱 선별 재시도 검증 보고서

- 검증일: 2026-09-03
- 대상: `REL-SRV-02`, `REL-SRV-03`, `REL-DEM-02`, `REL-DEM-03`, `REL-DEM-05`, `REL-SVC-04`
- 검증 방식: 서버 단위 fault injection, BFF 계약 시험, 전체 정적 품질 게이트

## 구현 결과

- Bedrock과 S3 SDK client에 `maxAttempts: 5`, `retryMode: adaptive`를 적용했습니다.
- 429, model timeout, 5xx와 Prisma 일시 연결 오류만 durable job 재시도 대상으로 분류합니다.
- validation, 접근 거부와 원본 리소스 없음은 영구 실패로 분류하고 수동 재시도도 차단합니다.
- durable job은 지수 백오프와 `nextAttemptAt`을 기록하며 최대 시도 횟수를 넘으면 `failed`로 종료합니다.
- 저장 오류 메시지는 고정된 안전 문구로 정규화해 내부 경로와 credential이 노출되지 않게 했습니다.
- chunk embedding 동시성은 기본 4, 허용 범위 1~16으로 제한하며 결과 순서를 유지합니다.
- 서비스 데모는 자동 재시도 대기, 일시 장애 후 중단과 영구 실패를 구분해 안내합니다.

## 자동 검증 결과

- AI Server: 24 suites, 121 tests PASS
- 검증 데모 자체 테스트: 11/11 PASS
- 서비스 데모: 15 files, 51 tests PASS
- AI Server typecheck, lint, build: PASS
- 서비스 데모 typecheck, lint, build: PASS
- `git diff --check`: PASS

## Migration 상태

`20260903090000_add_knowledge_index_job_retry_policy` migration을 추가했습니다. 현재 설정된 DB가 공인 IP를 사용하므로 자동 적용하지 않았습니다. 대상 환경을 확인한 뒤 `prisma migrate deploy`로 적용해야 합니다.

## 남은 검증

- 실제 Bedrock 429, timeout과 5xx 응답을 제어 가능한 adapter로 주입하는 통합 시나리오
- 실제 S3 원본 없음과 연결 오류, DB 연결 중단 및 embedding 부분 실패 복구
- 요청 timeout과 abort signal 전파, 서버 종료 중 진행 job의 lease 복구
- migration 적용 후 HTTP job 상태의 `queued → processing → queued(backoff) → completed/failed` 전체 흐름
