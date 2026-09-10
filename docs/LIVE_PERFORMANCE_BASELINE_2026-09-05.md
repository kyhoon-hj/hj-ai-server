# 실제 AWS 소규모 성능 기준선

2026-09-05 실제 AWS 호출로 데모 → 인증된 RAG API → 임베딩 검색·생성 → 성능 리포트 경로를 측정했다.

## 조건

- 리전: us-west-2, 생성: us.anthropic.claude-sonnet-4-6, 임베딩: amazon.titan-embed-text-v2:0
- 문서: quality-v2/store-a-policy.md 1개, 별도 테스트 테넌트와 격리 PostgreSQL
- 질의: STORE_A 교환·환불 조건. 5회, 동시성 1, maxTokens 256, temperature 0, strict true
- 별도 워밍업 요청 없음. 초기 연결 지연도 포함
- 실제 S3 업로드·인덱싱 후 실행. 셋업 호출은 아래 요청 통계에 포함하지 않음

## 결과

| 지표 | 측정값 |
|---|---:|
| HTTP 성공 | 5/5 (100%) |
| 전체 평균 | 2,018.07ms |
| 전체 p50 | 1,902.78ms |
| 전체 p95 / 최대 | 2,366.34ms |
| 검색 평균 / p95 | 308.40 / 409.92ms |
| 생성 평균 / p95 | 1,694.98 / 1,954.84ms |
| 처리량 | 0.50건/초 |
| 요청당 SDK 시도 | 2회 (검색 1 + 생성 1) |
| SDK 재시도 / 지연 | 0회 / 0ms |
| HTTP 429·타임아웃·연결 오류 | 각 0건 |
| 생성 입력 / 출력 토큰 합계 | 11,260 / 535 |
| 생성 토큰 총합 | 11,795 |

모든 응답은 answered/answerable=true이며 출처 1개를 제공했다. 문서의 구매 후 7일, 영수증·미사용 상품 조건, 개봉 위생용품·고객 과실 훼손 예외를 정확히 답했다. 실행 기록 5개를 보존했다.

5개 표본에서 p95는 최대값에 해당한다. 단일 문서·동일 질문의 초기 기준선이며 일반 트래픽 SLA나 부하 한계를 의미하지 않는다. 토큰 합계는 생성 응답 usage 기준으로, 문서 인덱싱·질의 임베딩 과금까지 포함한 총비용이 아니다.

## 실행 및 산출물

`npm run test:performance-baseline-live`를 추가했다. 기존 격리 DB runner와 S3 정리 절차를 재사용하고 `demo/scripts/performance-baseline.mjs`가 실제 데모 API를 호출한다. 11001 포트가 점유되어 있으면 기존 프로세스에 접근하지 않고 중단한다.

- 전체 리포트: `outputs/rag-quality/baseline-lzrAtA/report.json` (모델·리전·문서 조건 포함)
- 서버 실행 기록: `outputs/rag-quality/baseline-lzrAtA/server-executions.json`
- 데모 원본: `demo/reports/performance-2026-09-05T06-14-48-016Z.json`
- 실제 실행 테스트 1/1, 린트·JavaScript 구문 검사 통과
- S3 테스트 객체 1개와 격리 DB 제거, 서버 종료 및 데모 포트 해제 확인

다음은 동일 조건 반복 측정으로 변동 폭을 확인한 뒤 동시성 2와 비교하는 단계다.
