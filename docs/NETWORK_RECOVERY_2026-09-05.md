# 소켓 단절·외부 의존성 복구 검증 — 2026-09-05

## 결과와 수정

기존 함수 단위 오류 주입을 실제 소켓·SDK 경로로 확장했다. Bedrock HTTP/2 연결이 응답 헤더 전에 종료되거나 S3 스트림이 도중에 끊기면 `INDEXING_ERROR`, retryable false로 끝나는 결함을 재현했다. 알려진 전송 오류를 일시 장애로 분류하도록 수정하여 동일 job의 제한된 재시도로 복구한다.

- ECONNRESET/ECONNREFUSED/EPIPE, 일시 DNS·라우팅 오류와 일부 HTTP/2 세션 오류를 알려진 code로 판정한다.
- SDK가 감싼 오류는 최대 4단계 cause만 확인한다. NodeHttp2Handler의 code 없는 특정 no-response 메시지도 실제 재현한 정확한 문자열로 처리한다.
- 알려지지 않은 오류, ENOTFOUND, HTTP/2 프로토콜 불일치는 포괄적으로 재시도하지 않는다. 403 등 서비스 영구 오류는 새 transport 규칙으로 재분류하지 않는다.
- 오류 원문은 job 안내에 추가 저장하지 않고 기존 정규화된 메시지를 사용한다. 전체 파일 오류 로그 정책은 별도다.

## 검증 범위

| 시나리오 | 확인 내용 |
| --- | --- |
| Bedrock HTTP/2 연결 종료 | 실제 SDK 오류 → durable retry 대기 → 정상 응답 후 attempt 2 완료 |
| Bedrock 무응답 | 실제 deadline abort → UPSTREAM_TIMEOUT → 복구 |
| S3 스트림 중단 | 헤더·부분 본문 전송 후 소켓 종료, 기존 chunk 및 provenance 보존 후 복구 |
| S3 무응답 | 다운로드 deadline abort 및 작업 재시도 |
| Bedrock 503 / 429 | 실제 SDK 역직렬화와 작업 상태 전이, backoff 이후 복구 |
| 503 지속 | 최대 2회 후 failed, 추가 호출·수동 재시도 차단, 이전 인덱스 보존 |
| Bedrock 403 | 한 번만 호출하고 영구 실패 처리 |
| SDK 내부 재시도 | 503 후 SDK의 두 번째 HTTP 호출 성공, durable job은 attempt 1 유지 |
| DB 연결 단절 | 인덱싱 도중 워커의 실제 PostgreSQL 소켓을 종료하고 새 연결 차단, 기존 인덱스 보존, lease 자연 만료 후 연결 복구·attempt 2 완료 |

총 10개 네트워크 시나리오. 재시도 대기 중 동일 idempotency key가 같은 job을 반환하며, 최종 성공 때만 새 chunk·provenance로 교체되는지도 확인한다. 매 시나리오 후 활성 AWS 요청 컨트롤러가 0인지 확인한다.

로컬 HTTP/1 서버는 S3 응답을, HTTP/2 서버는 Bedrock 응답을 합성한다. 실제 AWS SDK의 요청·역직렬화·timeout·adaptive retry 및 실제 PostgreSQL/pgvector를 사용한다. AWS 클라우드 자체의 429/5xx를 재현한 결과가 아니다. 합성 SDK 자격 증명과 loopback endpoint를 명시하므로 이 suite는 실제 AWS에 연결하지 않는다.

DB proxy는 UUID 임시 DB의 loopback 주소만 허용한다. 워커 연결만 끊고 관측용 연결은 직접 연결을 유지한다. 테스트에서 lease를 1.2초, DB 연결 timeout을 300ms로 제한하며 실제 시간을 기다린다. 운영 lease 5분·기본 pool 설정의 시간 보장, DB 재기동, COMMIT 응답 유실, 장기 네트워크 분할·부하는 이번 결과에 포함하지 않는다. 복구는 `drain`의 다음 실행으로 확인한다.

SDK 내부 재시도와 durable job 재시도를 구분하기 위해 대부분의 시나리오는 SDK maxAttempts 1, 별도 시나리오는 2를 사용한다. 기본 운영 SDK maxAttempts 5 전체 조합을 측정한 것은 아니다. 429 이후 adaptive limiter 대기를 허용하는 시나리오는 deadline 4초, 무응답 시나리오는 500ms로 실행한다.

## 실행·증거

```text
npm run test:network-e2e
npm run test:queue-http-e2e
npm run verify
```

전용 네트워크 suite는 10/10 PASS. 서버 build/typecheck/lint, 단위 197개, 검증 데모 37개 PASS. 기존 회귀와 네트워크를 합친 격리 DB 통합은 7개 suite / 34개 테스트 PASS (Jest 31.402초), UUID 임시 DB 정리 완료. 소켓·SDK client·proxy도 정리한다. 서버 설정·운영 DB·방화벽·IAM은 변경하지 않는다.

실제 AWS 사전 점검은 최초 세션 만료로 실패했으나 사용자 승인 후 `aws login`으로 default profile을 갱신했다. STS 계정/identity 확인 및 `us-west-2`의 Sonnet 4.6 접근 AUTHORIZED를 확인했다.

`npm run test:aws-live-failures` 재실행 결과 2/2 PASS:

- S3 `ap-northeast-2`: 임의의 존재하지 않는 key 조회 → NoSuchKey / HTTP 404 / SDK attempts 1 / INDEX_SOURCE_NOT_FOUND / retryable false.
- Bedrock `us-west-2`: 존재하지 않는 모델 ID 호출 → ValidationException / HTTP 400 / SDK attempts 1 / INVALID_INDEX_REQUEST / retryable false.

이 probe는 객체 쓰기·DB 변경·IAM 변경·유효한 모델 생성을 하지 않는다. 실제 AWS 영구 오류 분류의 재검증이며, 실제 AWS 일시 장애·복구를 재현한 것은 아니다. 단계 3 전체 종료는 아직 선언하지 않는다.

후속 완료: [실제 AWS 연결 복구](LIVE_AWS_CONNECTION_RECOVERY_2026-09-05.md), [인덱스 COMMIT 응답 유실](DB_COMMIT_RESPONSE_LOSS_2026-09-05.md). 현재 네트워크 11/11·격리 DB 통합 35/35 PASS. 위 10개/34개 수치는 최초 실행 이력이며 장기 분할/부하는 남아 있다.
