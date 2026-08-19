# 데모 사용 가이드

## 실행 전 준비

1. AI Server의 DB migration을 적용합니다.
2. AI Server와 PostgreSQL 연결을 확인합니다.
3. Bedrock 및 S3 접근 권한을 확인합니다.
4. AI Server의 `ADMIN_API_KEY`, `KNOWLEDGE_OPERATOR_API_KEY`와 같은 값을 각각 관리자·지식 운영자 credential에 입력합니다. 수동 소비자 시험에는 별도 appkey를 사용합니다.
5. AI Server를 실행한 뒤 데모를 실행합니다.

```powershell
cd C:\Work\HJSolution\HJ_AI_Server\demo
npm test
npm start
```

## 권장 점검 순서

1. 연결 설정에서 로컬 `http://127.0.0.1:11000`을 선택하고 관리자·지식 운영자 credential을 저장합니다. 값은 데모 서버 메모리에만 유지됩니다.
2. `검증 환경 구성`을 실행합니다. 플랫폼 관리자가 STORE_A/STORE_B를 만들고 지식 운영자가 버전 fixture 6개를 등록·인덱싱·게시합니다. STORE_A에는 Markdown, CSV, PDF, DOCX, XLSX 5개가, STORE_B에는 Markdown 1개가 구성됩니다.
3. `다중 형식 parser 검증`을 실행합니다. PDF page metadata, DOCX table text, XLSX sheet·실제 행 번호와 각 형식의 검색 marker가 6/6 PASS인지 확인합니다.
4. `지식 전체 흐름 검증`을 실행합니다. 실제 multipart upload부터 index, policy, search, grounded answer와 임시 S3/chunk 정리까지 6/6 PASS인지 확인합니다.
5. `역할 권한 검증`과 `테넌트 격리 검증`을 실행합니다. 역할 권한은 6/6, 테넌트 격리는 8/8 PASS인지 확인합니다.
6. `credential 수명주기 검증`을 실행해 신규 appkey 만료, grace 기간의 신·구 키 허용, 종료 후 이전 키 거부와 감사 이벤트가 4/4 PASS인지 확인합니다. 이 시험은 STORE_B appkey를 회전합니다.
7. 자동 계약 검증을 실행합니다. 14/14 PASS, SKIP 0인지 확인합니다.
8. Swagger 경로와 CORS 허용 Origin을 대상 환경 설정에 맞춘 뒤 `HTTP 노출 보안 검증` 4/4 PASS를 확인합니다.
9. `운영 API 경계 검증`을 실행해 legacy·개발 endpoint 차단과 관리자 대체 경로가 8/8 PASS인지 확인합니다.
10. 전체 기능에서 추가 endpoint와 파일 업로드·다운로드를 수동 확인합니다.
11. 성능 검증을 동시 1부터 시작합니다.
12. 작업이 끝나면 `데모 데이터 정리 확인`을 선택하고 `검증 데이터 정리`를 실행합니다.

정리 시나리오는 지식 파일을 보관 처리하고 chunk와 S3 원본을 제거한 뒤 `hj-ai-demo-store-a`, `hj-ai-demo-store-b` app을 삭제합니다. 같은 fixture를 다시 구성할 수 있습니다. 구성·격리 검증·정리는 기본적으로 로컬 대상에서만 허용됩니다.

## 성능 시험 안전 수칙

- 운영 트래픽이 있는 서버에서 임의로 실행하지 않습니다.
- 처음에는 20회, 동시 1개로 실행합니다.
- 이후 동시 5개, 10개 순서로 높입니다.
- 429 또는 timeout이 나타나면 즉시 동시성을 낮춥니다.
- Converse/RAG 요청에는 항상 `maxTokens`를 명시합니다.
- 출력 토큰의 실제 p95를 기준으로 `maxTokens`를 조정합니다.

Bedrock는 요청 시작 시 입력 토큰과 `maxTokens`를 기준으로 TPM을 예약합니다. 필요 이상으로 큰 `maxTokens`는 동시 처리량을 낮추고 예상치 못한 throttling을 유발합니다.

## 리포트

구성, parser 회귀, 격리, 정리, 계약 및 성능 시험 결과는 `demo/reports/*.json`으로 생성됩니다. 리포트에는 appkey가 기록되지 않지만 질문과 응답 샘플은 포함될 수 있으므로 개인정보나 실제 고객 데이터를 입력하지 않습니다. PDF/DOCX/XLSX setup은 실제 S3 업로드와 Bedrock embedding을 수행하므로 네트워크와 quota 상태에 따라 수십 초가 걸릴 수 있습니다.
