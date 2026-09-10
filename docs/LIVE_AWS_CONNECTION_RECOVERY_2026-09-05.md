# 실제 AWS 연결 장애 복구 — 2026-09-05

## 결과

실제 AWS S3·Bedrock까지 연결한 TLS 중계 경로에 장애를 주입하여 2/2 시나리오를 통과했다. 운영 서버·DB·IAM·방화벽은 변경하지 않았다. 기존 재시도 분류기로 정상 복구하여 이번 작업에서는 운영 서버 코드를 추가 수정하지 않았다.

| 시나리오 | 실패·보존 | 복구 결과 |
| --- | --- | --- |
| S3 연결 단절 | AWS로부터 TLS 데이터를 받은 직후 연결 종료. UPSTREAM_TIMEOUT, queued, attempt 1. 기존 chunk·embedding·provenance 유지 | 중계 복구 후 같은 job attempt 2 완료, 청크 1개 교체, 약 1.00초 |
| Bedrock 연결 지연 | AWS TLS 반환 데이터를 전달하지 않아 8초 deadline 발생. UPSTREAM_TIMEOUT, queued, attempt 1. 기존 인덱스 유지 | 중계 복구 후 같은 job attempt 2 완료, 실제 Titan 1024차원 embedding 저장, 약 9.14초 |

최종 정상 실행은 Node test 2개 PASS, 약 11.34초다. 같은 idempotency key가 같은 job ID를 반환하고, 성공 후 중복 청크 없이 1개만 존재함을 확인했다. HTTP 답변 생성이나 모델 품질 평가는 이번 범위가 아니다.

이는 실제 AWS와 연결된 **클라이언트 연결 경로의 장애**다. AWS 서비스 내부에서 429/5xx가 발생하도록 유도한 시험, 추론 완료 후 응답만 유실한 시험, 운영 장애 복구 시간의 보증은 아니다. 장애는 TLS 수립 중 발생하며 복구 후 실제 GetObject/InvokeModel이 성공하는지를 확인한다.

## 구성과 제한

- 로컬 UUID 임시 PostgreSQL DB에 13개 migration을 적용하고 테스트 tenant를 생성한다. 정상 워커와 parser/chunker, pgvector 저장 경로를 사용한다.
- S3 `ap-northeast-2`, Bedrock `us-west-2`, `amazon.titan-embed-text-v2:0`. 합성 문서 1개, 1청크. 답변 생성 모델은 호출하지 않는다.
- TCP 중계기는 허용된 AWS regional hostname의 443 포트에만 연결한다. TLS 내용을 해독·로깅하지 않는다. 클라이언트는 AWS hostname을 SNI로 사용하고 인증서 검증을 유지한다.
- SDK maxAttempts 1, durable job maxAttempts 2, embedding 동시성 1. 한 실행의 임베딩 시도를 최대 4회, 각 중계기 연결을 최대 20회로 제한한다. 개별 시나리오 45초, 초기화 60초, 프로세스 300초 상한.
- 최종 실행은 임베딩 시도 4회였다. 초기 Jest 진단 실행 2회까지 합치면 이번 작업의 임베딩 시도는 총 8회다. 실패 시도에는 TLS 지연으로 서비스 추론까지 도달하지 못한 호출도 포함된다. 달러 비용을 측정하거나 금액 기준 차단을 구현한 것은 아니다.

## 테스트 환경 문제와 해결

초기 Jest 실행에서는 네이티브 TLS 오류의 realm이 달라 Smithy의 `instanceof Error/Object` 검사에서 원래 code가 소실되는 문제가 나타났다. 일반 Node 프로세스에서 동일 단절은 `TimeoutError` / `ECONNRESET`으로 유지됐다. 테스트 전용 문자열을 운영 분류기에 추가하지 않고, 실제 AWS harness를 `node:test` + ts-node의 일반 프로세스로 전환했다.

## 정리와 산출물

버킷의 버전 관리가 Enabled임을 확인했다. 일반 DeleteObject만으로는 삭제 마커와 과거 객체 버전이 남으므로, 이 harness의 정확한 UUID 키에만 적용되는 버전 정리 함수를 추가했다. Prefix 응답의 키가 정확히 일치하고 pagination이 없음을 확인한 뒤 VersionId를 지정해 삭제하며, 재조회에서 객체 버전·삭제 마커가 모두 0인지 확인한다.

개발 중 실행 3회의 테스트 키에서 각각 객체 버전 1개·삭제 마커 1개를 제거했다. 총 6개 삭제 후 각 키의 잔여 버전/마커 0을 확인했다. 세 실행의 UUID 임시 DB도 모두 정리됐다. 새 harness는 종료 시 이 버전 정리 함수를 직접 호출한다.

Git 제외 원본 결과:

- `outputs/aws-network/10ea161f-4d0e-41f0-a60b-e57a9212d584.json`: 최종 2/2 PASS 및 중계기 카운터.
- `outputs/aws-network/version-cleanup.json`: 세 UUID 키의 버전 정리·잔여 0 검증.
- 초기 진단 실행 `695977f8-b956-4497-96e9-deaa61a152dc`, `6e68b866-3698-46e2-886c-8d677cd4e097`도 이력으로 보존한다. 이 결과를 성공으로 합산하지 않는다.

재실행: `npm run test:aws-network-e2e`. 유효한 AWS 인증과 S3 Put/Get/ListObjectVersions/DeleteObjectVersion, Bedrock InvokeModel 권한 및 로컬 PostgreSQL이 필요하다. 일반 CI에는 포함하지 않는다.

후속 [인덱스 COMMIT 응답 유실](DB_COMMIT_RESPONSE_LOSS_2026-09-05.md) 검증 완료. 다음은 장기 네트워크 분할·부하 검증이다. 단계 3 전체 종료 및 운영 배포 승인은 별도다.
