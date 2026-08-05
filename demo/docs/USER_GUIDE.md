# 데모 사용 가이드

## 실행 전 준비

1. AI Server의 DB migration을 적용합니다.
2. AI Server와 PostgreSQL 연결을 확인합니다.
3. Bedrock 및 S3 접근 권한을 확인합니다.
4. 데모용 AppInfo와 appkey를 준비합니다.
5. AI Server를 실행한 뒤 데모를 실행합니다.

```powershell
cd C:\Work\HJSolution\HJ_AI_Server\demo
npm test
npm start
```

## 권장 점검 순서

1. 연결 설정에서 로컬(`http://127.0.0.1:11000/ai`) 또는 운영(`https://ai.hjshub.com`) 환경을 선택하고 AI Server URL과 appkey를 저장합니다. 운영 환경의 성능 시험은 운영 승인 후에만 실행합니다.
2. 전체 기능에서 `기본 상태 확인`, `Bedrock 설정`을 호출합니다.
3. `지식 파일 업로드`로 fixture를 등록합니다.
4. 파일 상세에서 ID를 복사하고 인덱싱을 실행합니다.
5. 정책을 `PUBLIC`, `PUBLISHED`로 변경합니다.
6. 검색, RAG 응답, 제품 RAG 답변을 차례로 확인합니다.
7. 자동 계약 검증을 실행합니다.
8. 성능 검증을 동시 1부터 시작합니다.

## 성능 시험 안전 수칙

- 운영 트래픽이 있는 서버에서 임의로 실행하지 않습니다.
- 처음에는 20회, 동시 1개로 실행합니다.
- 이후 동시 5개, 10개 순서로 높입니다.
- 429 또는 timeout이 나타나면 즉시 동시성을 낮춥니다.
- Converse/RAG 요청에는 항상 `maxTokens`를 명시합니다.
- 출력 토큰의 실제 p95를 기준으로 `maxTokens`를 조정합니다.

Bedrock는 요청 시작 시 입력 토큰과 `maxTokens`를 기준으로 TPM을 예약합니다. 필요 이상으로 큰 `maxTokens`는 동시 처리량을 낮추고 예상치 못한 throttling을 유발합니다.

## 리포트

계약 및 성능 시험 결과는 `demo/reports/*.json`으로 생성됩니다. 리포트에는 appkey가 기록되지 않지만 질문과 응답 샘플은 포함될 수 있으므로 개인정보나 실제 고객 데이터를 입력하지 않습니다.
