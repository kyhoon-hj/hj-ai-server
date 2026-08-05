# 기능·품질·성능 검증 전략

## 시험 계층

1. 단위 시험: DTO, policy, chunking, quota, 오류 변환
2. 통합 시험: 실제 PostgreSQL/pgvector와 repository 동작
3. 계약 시험: 데모가 HTTP를 통해 외부 응답 구조 확인
4. 품질 시험: 질문별 answerable, source, policy filter 평가
5. 성능 시험: smoke, baseline, burst, soak
6. 장애 시험: Bedrock/S3/DB timeout, 429, 5xx, 부분 실패

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
