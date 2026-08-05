# HJ AI Server Demo Console

HJ AI Server의 기능, 외부 API 계약, RAG 품질과 제한된 동시 처리 성능을 점검하는 내부 검증 프로그램입니다.

```powershell
cd demo
npm start
```

브라우저에서 `http://127.0.0.1:3200`을 엽니다. 기본 AI Server 주소는 `http://127.0.0.1:3000`이며 화면에서 변경할 수 있습니다.

```powershell
$env:AI_SERVER_BASE_URL='http://127.0.0.1:11000'
$env:AI_SERVER_APPKEY='<appkey>'
$env:DEMO_PORT='3200'
npm start
```

appkey는 데모 서버 메모리에만 보관되고 API 응답이나 브라우저 저장소로 반환되지 않습니다. 데모 서버는 기본적으로 loopback 인터페이스에만 바인딩됩니다.

## 제공 기능

- AppInfo, Bedrock, Storage, Knowledge 전체 endpoint 호출
- JSON 요청·응답 및 correlation ID 확인
- 일반/지식 파일 multipart 업로드
- 파괴적 endpoint 실행 확인
- 핵심 계약 자동 시나리오와 JSON 리포트
- 제한된 부하 시험과 p50/p95/p99, 처리량, 상태 코드, 토큰 집계
- 재현 가능한 지식 fixture

상세 문서는 [docs/DEMO_PLAN.md](docs/DEMO_PLAN.md), [docs/USER_GUIDE.md](docs/USER_GUIDE.md), [docs/VALIDATION_MATRIX.md](docs/VALIDATION_MATRIX.md)를 참고합니다.
