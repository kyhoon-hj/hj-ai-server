# RAG 검색·생성 시간과 토큰 측정

2026-09-05. 로드맵 PERF-DEM-01/02의 RAG 측정 경로를 구현했다. 별도 스키마 migration 없이 기존 query log execution JSON을 확장한다.

## 서버 계약

`POST /knowledge/answers`와 호환 `rag-response` 응답에 다음 필드를 추가한다. 기존 latencyMs·usage·답변 계약은 유지한다. answers Swagger에도 선택 필드로 명시했다.

```json
{
  "performance": { "retrievalMs": 25, "generationMs": 40, "maxTokens": 257 }
}
```

- retrievalMs: 질문 embedding과 DB 검색/fallback 전체. quota 사전 점검은 제외한다.
- generationMs: 생성 SDK 요청의 대기·재시도·timeout/취소 완료까지. 응답 파싱과 로그 저장은 제외한다. strict 모드에서 근거가 없어 모델을 호출하지 않으면 0이다.
- maxTokens: 서버가 적용한 생성 설정. 실제 outputTokens나 quota 예약량을 뜻하지 않는다. 모델을 호출하지 않아도 유효 설정은 기록한다.

단계 시간은 monotonic `performance.now()`로 측정해 소수 둘째 자리 ms로 저장한다. 전체 latencyMs 및 데모 HTTP durationMs와 경계가 달라 단계 시간 합이 전체 시간과 정확히 같지는 않다. 데모 전체 시간에는 네트워크와 서버 로그 저장 등도 포함된다.

성공·근거 부족·검색 오류·생성 오류 모두 `knowledge_query_log.execution.performance`에 측정값을 남긴다. 오류는 기존 오류를 그대로 전달하고 오류 응답에 내부 진단을 새로 노출하지 않는다. 기록 저장 실패 시 기존 정책대로 원래 오류를 유지한다. quota 점검 등 측정 구간 진입 전 오류는 이 범위에 포함하지 않는다.

## 검증 데모

성능 리포트에 검색/생성의 측정 응답 수·평균·p50·p95, input/output/total 합계와 각각의 측정 응답 수, 응답당 평균 토큰, output token p50/p95, 요청 maxTokens와 서버 실효 maxTokens 집합을 기록한다. 화면에는 단계별 p95·측정 건수·입출력 토큰·평균 토큰·maxTokens를 표시한다.

미지원 endpoint/이전 서버/HTTP 오류로 값이 없으면 null 또는 빈 집합이며 화면에서 '미측정'이다. 누락값을 0으로 평균에 넣지 않는다. 명시적 0ms·0 token은 유효한 관측값이다. 평균 토큰의 분모는 전체 요청 수가 아닌 totalTokens가 보고된 응답 수다. 이전 형식 inputtokens/outputtokens/totaltokens도 지원한다.

생성 시간 집계에는 모델 미호출이 명시된 0ms도 포함한다. 실패 응답에 단계 시간이 없는 경우 성능 화면 집계에서는 제외되지만 서버 query log에서 확인할 수 있다. usage가 null인 무호출 응답에 token 0을 새로 추정하지 않는다. usage 집계는 API가 반환한 생성 토큰이며 embedding 비용까지 포함한 과금 총량이 아니다.

## 검증

- 최종 `npm run verify`: build/typecheck/lint·서버 201개·데모 41개 PASS. 데모 server.mjs와 app.js의 구문 검사도 PASS.
- 서버 계약 4개 추가: 성공/근거 부족/검색 오류/생성 오류에 가상 시간 25ms·40ms를 적용해 응답·영속 기록과 모델 호출 횟수 확인.
- 데모 집계 4개 추가: 누락/실패 분모 제외, 명시적 0과 null 구분, 이전 형식, 잘못된 숫자 제외.
- 실제 격리 DB 통합 39개 PASS(45.287초). 새 performance 값이 query log에 저장되고 재색인·삭제 후에도 유지되는지 확인. 임시 DB `queue_e2e_0f3a34bd97734a1bb80c301d296135c8` 삭제 완료.
- Playwright로 실제 성능 화면에 합성 리포트를 표시해 25ms/80ms와 token/maxTokens 표시 및 이전 응답의 미측정 상태 확인. 표본 UI 이미지는 `output/playwright/rag-performance-measured.png`. UI fixture의 favicon 404 외 앱 오류는 관측하지 않았다. 브라우저·시험 서버 종료 완료.

측정 기능을 검증한 것이며 실제 AWS RAG 지연·비용 기준선을 새로 측정한 것은 아니다. 다음은 성능 프리셋 및 반복 비교 리포트, 모델 호출/미호출·실패 응답을 구분한 실측 집계다.
