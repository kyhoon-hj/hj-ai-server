# 다중 워커의 여러 lease 기간 DB 단절 복구

2026-09-05. 실제 로컬 PostgreSQL 소켓을 차단하고, 별도 Prisma 연결 풀을 가진 워커 3개가 복구 후 같은 작업을 경쟁해서 회수하는 시험을 추가했다. 운영 코드 수정은 필요하지 않았다.

## 시험 조건

- UUID 격리 DB, 워커별 pool 최대 연결 2개, DB 연결 timeout 300ms.
- 테스트 전용 lease 1.2초. 단절을 매번 최소 3.6초(lease 3회) 유지하고 100ms 간격으로 세 워커의 drain을 함께 실행한다. 단절 중 모든 drain이 연결 오류로 종료되는지 검사한다.
- 관측용 직접 DB 연결은 유지한다. 소스 다운로드 및 embedding은 기존 합성 HTTP/1·HTTP/2 서버와 실제 AWS SDK를 사용한다.
- 워커 3개는 같은 Node 프로세스에서 실행한다. DB 연결 풀은 독립적이고 SDK client는 공유한다. 자동 타이머 대신 명시적으로 동시 drain을 호출한다.

## 확인한 결과

1. **단절 후 동시 복구:** 첫 인덱싱의 embedding 응답 시 워커 DB 연결을 끊는다. 세 lease 기간 동안 작업은 processing/attempt 1에 머무르고 기존 청크는 보존되며 추가 embedding 호출도 없다. 연결 복구 후 세 워커가 동시에 drain해도 전체 attempt 2, embedding 호출 누계 2회로 완료된다. 최종 청크 1개와 1024차원 embedding·새 provenance를 확인했다. 세 워커의 동일 idempotency key 제출은 같은 job을 반환하며 추가 drain은 데이터를 변경하지 않는다.
2. **반복 단절 및 상한:** 시도 1과 2 각각에서 DB 연결을 차단하고 세 lease 기간씩 유지한다. 마지막 복구 시 세 워커가 경쟁해도 작업은 failed/attempt 2, INDEX_LEASE_EXPIRED, retryable false로 종료된다. 세 번째 embedding 호출은 없고 기존 인덱스가 그대로 남는다. 수동 retry도 거절된다.

## 실행 증거

`npm run test:network-e2e`: 13/13 PASS, 20.395초. 임시 DB `queue_e2e_6ce0c0df76b54b51a9660cc2a051defb` 삭제 완료.

`npm run test:queue-http-e2e`: 7 suites / 37개 PASS, 40.309초. 임시 DB `queue_e2e_cef34add028c44a5ab96b9aeb76efacc` 삭제 완료.

`npm run verify`: build/typecheck/lint PASS, 서버 단위 197개·검증 데모 37개 PASS.

## 범위와 다음 작업

이 결과는 짧은 테스트 lease를 기준으로 한 여러 lease 기간의 단절 검증이다. 운영 lease 5분으로 수십 분 이상 실행하는 soak 시험이나 여러 프로세스/호스트의 부하 결과가 아니다. 모든 워커의 DB 경로를 함께 차단하며, 일부 워커만 고립된 상태에서 늦은 응답이 도착하는 비대칭 분할은 별도다.

후속 [비대칭 단절 검증](ASYMMETRIC_PARTITION_2026-09-05.md)에서 워커별 연결 경로를 분리하고 이전 소유자의 늦은 성공·오류가 최신 인덱스·파일·작업을 변경하지 못함을 확인했다. 이후 운영 lease·동시 파일 수·시험 시간·복구 SLO를 정한 장시간 부하 시험으로 확장한다.
