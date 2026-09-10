# 성능 시험 실패 유형 및 재시도 관측

성능 리포트 `summary.outcomes`는 최종 HTTP 성공, HTTP 429, 데모 타임아웃, 연결 오류, 기타 HTTP 실패를 서로 겹치지 않게 집계한다. `failed`는 성공을 제외한 총 요청 수다. 기존 successRate와 statusCounts는 유지한다. HTTP 504는 서버에서 받은 HTTP 실패이며 데모 자체 타임아웃과 구분한다.

`summary.retries`는 demo-http 관측 범위를 명시한다. 데모는 논리 요청당 HTTP 호출을 한 번 수행하며 attempts는 요청 수, retryCount는 0이다. 서버 내부 SDK 시도 횟수는 알 수 없어 serverSdkAttempts=null이다. 타임아웃 뒤 서버 작업 완료 여부도 알 수 없다. 자동 재시도 동작은 추가하지 않았다.

지연은 응답 헤더뿐 아니라 전체 본문 수신까지 포함한다. 본문 수신 중 deadline으로 AbortError가 발생해도 해당 timeout signal을 확인해 데모 타임아웃으로 분류한다.

화면과 비교 JSON에 실패 유형 및 데모 재시도 횟수를 추가했다. 이전 리포트의 누락 값은 미측정으로 유지한다. 비교 조건에 HTTP timeoutMs와 retryPolicy를 추가했다. 재시도 관측 한계는 화면에도 표시한다.

## 검증

- 데모 테스트 49개 통과: 실패 유형의 배타적 분류, HTTP 504 구분, 이전 리포트 호환성과 비교 조건을 포함한다.
- 실제 demo/server.mjs와 로컬 합성 upstream 간 6회 시험: 성공 2건, HTTP 429 1건, HTTP 504 1건, 헤더 전/본문 수신 중 타임아웃 각 1건. 성공률 33.33%, 추가 호출 0회. 지연된 정상 본문 수신 시간 포함 확인.
- 실행 리포트: `demo/reports/performance-2026-09-05T04-55-37-996Z.json`.
- JavaScript 구문 검사 통과. 합성 서버와 시험 데모 프로세스 종료. 실제 AWS 호출 없음. 이번 변경의 브라우저 화면 검증은 실행하지 않았다.

다음 단계는 서버 SDK 메타데이터를 노출할 수 있는 호출 경계를 조사하고, 성공·실패 응답의 실제 시도 횟수를 추적하는 것이다.
