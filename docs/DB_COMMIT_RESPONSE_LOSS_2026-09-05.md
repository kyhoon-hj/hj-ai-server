# DB COMMIT 응답 유실 복구 검증

2026-09-05. 로컬 격리 PostgreSQL에서 인덱스 저장 트랜잭션은 커밋됐지만 워커가 완료 응답을 받지 못하는 상황을 재현했다. 운영 코드 변경 없이 기존 lease 회수 및 인덱스 교체 방식으로 복구한다.

## 재현과 판정

- `test/fixtures/tcp-fault-proxy.ts`가 PostgreSQL backend 메시지를 길이 단위로 조립한다. TCP 패킷이 나뉘거나 합쳐져도 `CommandComplete(COMMIT)`을 식별한다.
- 합성 embedding 응답 시점에 다음 COMMIT 응답 유실을 예약한다. 초기 파일 상태 트랜잭션은 이미 끝난 상태다.
- DB가 COMMIT 완료 메시지를 보낸 순간 해당 메시지와 후속 ReadyForQuery를 전달하지 않고 워커 소켓 및 신규 연결을 차단한다.
- 별도 직접 DB 연결로 새 청크·provenance와 파일 `indexed` 상태가 저장됐음을 확인한다. 작업은 `processing`, attempt 1로 남는다. 차단 횟수도 정확히 1인지 검사한다.
- 1.2초 테스트 lease가 실제로 만료된 뒤 연결을 복구한다. 동일 idempotency key는 같은 job을 반환하고 다음 drain에서 attempt 2로 완료된다.
- 재처리 후 청크는 1개, 내용과 1024차원 embedding은 기대값과 일치한다. 청크 ID·provenance가 다시 바뀌므로 이미 커밋된 인덱스를 재처리했음을 확인한다. 추가 drain은 인덱스나 embedding 호출 수를 바꾸지 않는다.

이는 exactly-once 실행 보장이 아니다. 응답 유실 시 embedding 및 인덱싱이 반복되지만 최종 인덱스에 중복 청크가 남지 않는다는 검증이다.

## 실행 결과

- `npm run test:network-e2e`: 11/11 PASS (7.693초).
- `npm run verify`: build/typecheck/lint PASS, 서버 197개·데모 37개 PASS.
- `npm run test:queue-http-e2e`: 7 suites, 35/35 PASS (29.005초). 통합 실행 DB `queue_e2e_170db211ec1b4ff1a6ae746ec21fcf23` 정리 완료.

전용 실행 DB `queue_e2e_6180fb4bebc44ca5b1d1c82622507428` 정리 완료. proxy는 UUID 테스트 DB의 loopback 연결만 허용하며 해당 연결에 `sslmode=disable`을 명시한다. AWS 호출·운영 DB 변경은 없다.

## 남은 범위

이번 사례는 인덱스 저장 COMMIT 응답 유실이다. 작업 완료 UPDATE 응답 유실, DB 재기동, 운영 lease 5분과 다중 워커에서의 장기 분할·부하, AWS 서비스 내부 429/5xx는 별도 검증이다. 다음 작업은 장기 분할 중 lease 회수·재시도 상한·동시 워커 중복 처리 방지를 함께 확인하는 시험이다.
