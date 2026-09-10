# 요청 SDK 집계 HTTP 및 화면 검증

`test/aws-metrics-http.e2e-spec.ts`에 독립적인 Nest HTTP 시험을 추가했다. 실제 KnowledgeService·EmbeddingService·AWS 요청 제어·interceptor·오류 필터를 사용하고, DB 및 SDK send만 합성 구현으로 대체한다. 시험 전용 컨트롤러이므로 운영 라우트 인증·DB 통합·실제 AWS 재시도 시험은 아니다. 실제 SDK 재시도 로직은 앞선 SDK 메타데이터 단위 시험에서 별도로 검증했다.

## HTTP 결과

- 동시 성공 요청: 검색+생성 총 시도 3회와 5회가 각각 분리됨.
- 생성 실패: 먼저 성공한 검색 2회와 실패한 생성 3회가 합계 5회로 반환됨. 실패 호출 지표는 3회로 별도 유지됨.
- 생성 타임아웃: HTTP 504 및 AWS_REQUEST_TIMEOUT, 작업 2개 중 1개만 측정되어 총 시도는 null.
- strict 근거 부족: 생성 없이 검색 시도 2회만 집계됨.

실행: `npx jest --config test/jest-e2e.json --runInBand test/aws-metrics-http.e2e-spec.ts` — 4/4 통과. 린트 통과.

## 화면 및 내보내기

실제 데모 정적 화면과 집계 함수를 사용하는 합성 UI 서버에서 Smoke 두 회차를 실행했다. 화면은 실제 AWS 성능 수치가 아니다.

- 요청 전체 SDK 시도 p95: 기준 3회, 현재 5회, 차이 +2, 변화율 66.67%.
- 재시도 지연 p95: 기준 10ms, 현재 30ms, 차이 +20ms, 변화율 200%.
- 현재 실행 JSON 및 비교 JSON 다운로드 후 같은 값을 파일에서 검사했다.
- 미측정인 기존 생성/실패 개별 지표는 미측정으로 표시됨.
- 증거: `output/playwright/request-sdk-metrics.png`, `request-sdk-run.json`, `request-sdk-comparison.json`.
- 콘솔 오류는 합성 서버의 favicon 404 한 건. 기능 오류 없음. 브라우저와 시험 서버 종료 완료.

집계 기능 수정은 필요하지 않았다. 다음은 운영 라우트와 실제 데모 API까지 연결한 인증 포함 통합 시험 또는 실제 AWS 소규모 성능 기준선 수립이다.
