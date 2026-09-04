# 기능·품질·성능 검증 전략

## 시험 계층

1. 단위 시험: DTO, policy, chunking, quota, 오류 변환
2. 통합 시험: 실제 PostgreSQL/pgvector와 repository 동작
3. 계약 시험: 데모가 HTTP를 통해 외부 응답 구조 확인
4. 품질 시험: 질문별 answerable, source, policy filter 평가
5. 성능 시험: smoke, baseline, burst, soak
6. 장애 시험: Bedrock/S3/DB timeout, 429, 5xx, 부분 실패

### AWS SDK HTTP 장애 계약 시험 (2026-09-04)

`npx jest --runInBand aws-transport.spec.ts` 또는 `npm run test:ci`로 실행합니다.
실제 SDK를 loopback 서버에 연결하며 Bedrock은 HTTP/2, S3는 HTTP/1.1을 사용합니다.
가짜 자격 증명과 로컬 endpoint를 명시하므로 AWS 호출, DB 변경, S3 객체 변경이 없습니다.

- 429/500/503 이후 두 번째 요청 성공 및 SDK attempts 확인
- 503의 최대 3회 시도 소진 및 작업 재시도 분류 확인
- 400 ValidationException, 403 AccessDeniedException, S3 404 NoSuchKey의 단일 시도 및 영구 실패 분류 확인
- 응답 없는 요청의 애플리케이션 deadline, 호출자 취소, active controller 정리 확인

9개 시험 통과. 이 결과는 실제 SDK 전송 계층을 사용한 **모의 장애 검증**이며,
실제 AWS 장애나 작업 큐/DB를 포함하는 end-to-end 검증을 의미하지 않습니다.
기존 `test:fault-e2e`는 별도로 로컬 DB의 작업 상태와 부분 실패 복구를 검증합니다.

### 실제 AWS 실패 호출 검증 (2026-09-04)

CLI 재인증 후 `npm run test:aws-live-failures`로 2개 검증을 통과했습니다.
이 명령은 실제 AWS에 접속하므로 기본 CI/verify에는 포함하지 않습니다.
`.env`의 `AWS_REGION`, `AWS_S3_BUCKET`, 선택적인 `AWS_S3_REGION`과
SDK 기본 자격 증명 체인을 사용합니다. 요청별 전체 제한은 20초입니다.

| 실제 응답 | 리전 | SDK 시도 | 서버 오류 분류 | 재시도 |
|---|---|---|---|---|
| S3 NoSuchKey / 404 | ap-northeast-2 | 1 | INDEX_SOURCE_NOT_FOUND | 제외 |
| Bedrock ValidationException / 400 | us-west-2 | 1 | INVALID_INDEX_REQUEST | 제외 |

무작위 UUID 키와 존재하지 않는 모델 ID만 사용했습니다. S3 객체/DB/IAM 변경은 없으며,
정상 모델 추론은 수행하지 않았습니다. SDK 오류 메시지·서명 헤더·자격 증명은 출력하지 않습니다.
S3가 403을 반환하면 404 검증 성공으로 취급하지 않고 FAIL로 보고합니다.
실제 AWS의 429/5xx 유발 부하 시험은 수행하지 않았으며 해당 경로는 위 모의 장애 시험으로 구분합니다.
이 검증은 SDK 요청 제어와 오류 분류까지이며 HTTP API·작업 큐·DB를 통과하는 E2E나
정상 모델 호출 권한 검증은 아닙니다.

### HTTP API·작업 큐 통합 시험 (2026-09-04)

`npm run test:queue-http-e2e`는 로컬 PostgreSQL에 무작위 이름의 임시 DB를 만들고,
12개 마이그레이션을 적용한 후 실제 AppModule의 인증·HTTP 컨트롤러·워커·Prisma 저장을 검증합니다.
기존 서버의 워커와 DB를 공유하지 않습니다. DB 생성 권한 및 pgvector 설치가 필요합니다.
PostgreSQL 18에서 확장 경로를 DB별로 설정한 경우, 원본 DB의 `extension_control_path`와
`dynamic_library_path`를 임시 DB에만 복사합니다. 원본 DB 설정은 변경하지 않습니다.

3개 시험 통과:

- 인증 없는 제출 401, 동일 키 중복 제출 방지, 완료 상태 조회, 다른 앱의 작업 조회 404, 다른 작업에 같은 키 재사용 409
- 통제된 429 실패 후 실제 백그라운드 워커가 자동 재시도하여 2회째 완료
- 통제된 NoSuchKey 영구 실패 저장, 원본 오류 메시지 비노출, 수동 재시도 400

인덱싱 함수는 테스트 대역이며 실제 S3/Bedrock 호출 및 청크/벡터 저장 검증은 포함하지 않습니다.
기본 CI에는 포함하지 않으며, 종료 시 이번 실행이 만든 임시 DB만 삭제합니다.
프로세스 강제 종료 시 정리가 실행되지 않을 수 있으므로 출력된 `queue_e2e_<UUID>` DB를 확인해야 합니다.

### 파서·청크·pgvector 통합 시험 (2026-09-04)

`npm run test:queue-http-e2e`는 HTTP 시험 3개, 벡터 시험 4개, 기존 장애 시험 7개,
워커 프로세스 재시작 시험 2개, 전체 AppModule 종료 시험 1개와 임대/소유권 시험 6개를
격리 DB에서 함께 실행합니다(총 23개 통과).
벡터 시험은 실제 KnowledgeService, 텍스트 파서, ChunkingService, 작업 큐 서비스,
Prisma 트랜잭션 및 pgvector SQL을 사용합니다. 원본 다운로드는 메모리 텍스트로,
임베딩은 고정 1024차원 벡터로 대체하며 AWS에 요청하지 않습니다.

- 여러 청크 생성, 벡터 차원·값 저장, 코사인 검색 점수, 앱 격리 및 게시 상태 필터 검증
- 메모리 검색 fallback이 호출되면 실패하도록 하여 실제 pgvector 검색 경로 검증
- 새 청크의 첫 임베딩 성공 후 두 번째에서 429를 주입하여 기존 청크 ID·내용·벡터 보존 검증
- 작업 재시도 성공 후 이전 청크 교체 및 검색 복구 검증

재인덱싱 가용성 개선: 기존 `indexed` 파일은 처리 중·실패 후에도 `indexed` 상태를 유지해
이전 스냅샷으로 검색합니다. 오류는 파일의 errorMessage 및 작업 상태에 기록합니다.
최초 인덱싱 실패는 계속 `failed`로 처리합니다. 새 청크, 벡터, indexedAt, 파싱 메타데이터는
하나의 트랜잭션에서 교체하며 실제 벡터 UPDATE 제약조건 실패를 주입해 전체 롤백을 확인했습니다.
인덱싱의 벡터 저장 실패는 더 이상 무시하지 않습니다(pgvector 설치·마이그레이션 필수).
처리 중 임베딩을 보류한 상태에서도 기존 검색 결과가 유지됨을 확인했습니다.

이 보장은 `indexKnowledgeFile` 재인덱싱 경로에 적용됩니다. 직접 텍스트 upsert 경로,
동시 보관/정책 변경, 서버 프로세스 재시작 복구, 실제 AWS 연결, 다른 문서 형식은 이 시험의 범위 밖입니다.

### 워커 종료·재시작 검증 (2026-09-04)

종료 시작 시 워커는 신규 submit/retry를 503으로 거절하고 새 작업을 가져오지 않습니다.
종료 중 DB claim이 완료된 경우 해당 작업을 queued로 반환하고 미실행 시도를 되돌립니다.
진행 중 요청은 취소 후 작업 상태 저장이 끝날 때까지 기다립니다.

별도 Node 워커 프로세스와 실제 격리 DB에서 다음을 확인했습니다.

- IPC 종료 요청으로 실제 onModuleDestroy 실행: 진행 작업은 queued/attempt=1, 다음 작업은 queued/attempt=0 유지
- 새 프로세스 시작 후 각각 attempt=2와 attempt=1로 완료
- 처리 도중 프로세스 강제 종료 후 processing 상태가 남으며, 만료된 lease는 재시작 시 회수하여 완료

인덱싱 의존성은 통제된 대기/성공 함수입니다. lease 만료는 테스트 행의 시각을 조정했으며
전체 HTTP 서버·Docker의 SIGTERM 및 Prisma 종료 훅 순서를 검증한 것은 아닙니다.
시작 후 만료되는 작업의 주기적 회수와 장시간 작업의 임대 갱신·소유권 보호는 아래 시험으로 추가 검증했습니다.

### 전체 AppModule 종료 순서 보완 (2026-09-04)

Prisma 연결 종료를 `onModuleDestroy`에서 `onApplicationShutdown`으로 이동했습니다.
설치된 Nest의 종료 순서에 따라 모든 모듈의 destroy 훅과 HTTP 서버 정리가 완료된 뒤
DB 연결을 닫습니다. 워커의 취소 상태 저장과 DB 연결 종료가 경쟁하지 않도록 하기 위함입니다.

실제 AppModule과 HTTP listener를 실행하고 인덱싱 의존성을 대기 상태로 만든 뒤 `app.close()`를 호출했습니다.
독립 Prisma 연결로 DB를 관찰하여 워커의 queued/attempt=1/lease=null 저장이
앱 Prisma의 disconnect보다 먼저 완료됨을 확인했고 HTTP listener 종료도 확인했습니다.
이는 Nest 전체 수명주기 검증이며 Docker SIGTERM 전달·강제 종료 경로의 검증은 아닙니다.
Docker 신호 검증은 아래 별도 시험으로 수행합니다.

### Docker SIGTERM 검증 (2026-09-04)

`npm run test:docker-shutdown`으로 최신 코드를 빌드하고 임시 DB를 생성한 뒤 별도 컨테이너를 실행합니다.
기본 이미지는 실행 중인 `hj_ai_server-app-1`의 이미지 ID를 읽어 사용하며,
`DOCKER_SHUTDOWN_TEST_IMAGE`로 동일 의존성을 포함한 다른 이미지를 지정할 수 있습니다.
최신 dist와 현재 시작 래퍼, 테스트 진입점만 읽기 전용으로 연결합니다.
기존 컨테이너를 수정하거나 재시작하지 않으며 호스트 포트도 공개하지 않습니다.

실제 `config/start-container.mjs`가 마이그레이션을 실행하고 전체 AppModule을 시작합니다.
인덱싱 의존성만 취소 가능한 대기 함수로 대체하며 AWS 자격 증명은 전달하지 않습니다.
컨테이너 내부 HTTP 서버와 진행 작업을 확인한 후 `docker stop --time 20`으로 종료했습니다.

- 시작 래퍼를 거친 SIGTERM 종료 코드 0 확인(강제 종료 137 아님)
- 진행 작업 queued/attempt=1/UPSTREAM_TIMEOUT 저장 확인
- 다음 작업 queued/attempt=0 유지 확인
- 생성한 테스트 컨테이너와 임시 DB 삭제 확인

이 시험은 현재 의존성 이미지에 최신 코드를 연결한 종료 경로 검증입니다.
새 production 이미지 빌드/배포 검증이나 실제 AWS 호출의 종료 검증은 아닙니다.

### 임대 자동 회수·갱신·소유권 보호 (2026-09-04)

- 기본 임대 5분, 100초마다 갱신. 워커의 500ms 스케줄에서 만료 작업 회수도 수행합니다.
- 만료 작업은 시도 횟수가 남으면 queued, 한도에 도달했으면 failed/INDEX_LEASE_EXPIRED로 전환합니다.
- 작업 ID와 증가하는 attempt를 소유권 표식으로 사용합니다. 갱신 및 최종 상태 저장은
  현재 processing 상태·시도 번호·유효 임대가 일치할 때만 허용합니다.
- 갱신 실패/소유권 상실 시 해당 작업의 AbortSignal을 취소합니다. 의존성이 취소를 무시해도
  청크 교체와 파일 상태 저장 트랜잭션의 작업 행 잠금 및 소유권 검사로 뒤늦은 쓰기를 차단합니다.
- SQL 임대 시각 비교는 UTC를 명시합니다. Asia/Seoul 서버에서 timestamp/timestamptz
  암시적 변환으로 정상 작업을 만료시키는 회귀를 실제 두 워커 시험에서 확인하고 수정했습니다.

추가 6개 시험: 시작 후 만료 회수, 두 워커에서 장시간 작업 갱신, 최대 시도 소진,
이전 워커의 늦은 완료 상태 차단, 이전 워커의 성공/실패 후 청크·파일 쓰기 차단.
갱신 시험은 테스트 서브클래스에서 임대를 900ms로 줄여 실제 시간·DB로 실행합니다.
Docker SIGTERM 시험도 재통과했습니다.

DB 스키마 추가는 없습니다. 배포 시 구버전 워커를 모두 종료한 후 신버전을 시작해야 합니다.
구버전 워커는 소유권 검사를 하지 않으므로 혼합 실행은 보호 범위 밖입니다.
이 보장은 작업 큐의 재인덱싱 경로에 적용되며, 직접 동기 인덱싱·동시 수동 정책 변경과의
충돌 제어 및 서버 간 시계 오차/장시간 네트워크 분할 부하 시험은 별도 범위입니다.

## 성능 단계

| 단계 | 기본 부하 | 목적 |
|---|---:|---|
| Smoke | 1 concurrency, 20 requests | 기능과 측정값 검증 |
| Baseline | 5 concurrency, 100 requests | 정상 운영 기준선 |
| Burst | 20 concurrency, 200 requests | 429, timeout, queue 압력 |
| Soak | 별도 도구로 30분 이상 | 누수와 장기 안정성 |

데모 내 러너는 안전을 위해 최대 200회와 동시 20개로 제한합니다. 장시간 soak와 높은 부하는 격리된 staging에서 전용 부하 도구로 수행합니다.

## Bedrock 측정 해석

Bedrock는 요청 시작 시 대략 입력 토큰과 `maxTokens`를 기반으로 TPM을 예약합니다. 따라서 다음 값을 한 리포트에서 비교합니다.

- 요청별 input/output/total token
- 설정한 maxTokens
- 성공률과 429 비율
- p50/p95/p99 latency
- CloudWatch Invocations/InvocationThrottles
- InputTokenCount/OutputTokenCount/InvocationLatency

`maxTokens`가 실제 output token p95보다 과도하게 크면 먼저 낮추고, 이후 quota 증가나 cross-region inference를 판단합니다.

## RAG 품질 판정

생성 문장의 exact match를 사용하지 않습니다. 각 case는 다음 기대값을 가집니다.

```json
{
  "query": "교환 기간은 며칠인가요?",
  "expectedAnswerable": true,
  "expectedSource": "store-a-policy.md",
  "requiredFacts": ["7일", "영수증", "미사용"],
  "forbiddenFacts": ["30일"],
  "filters": {
    "accessLevels": ["PUBLIC"],
    "businessStatuses": ["PUBLISHED"]
  }
}
```

핵심 지표는 answerable 정확도, source 적중률, 필수 사실 포함률, 금지 사실 발생률입니다.

## CI 배포 게이트

- build 및 lint 성공
- unit/integration/contract 성공
- migration 상태 일치
- OpenAPI breaking change 없음
- dependency high vulnerability 기준 충족
- staging smoke 성능 기준 충족
