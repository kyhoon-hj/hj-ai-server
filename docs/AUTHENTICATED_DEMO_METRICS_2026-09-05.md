# 인증 포함 데모 성능 리포트 통합 검증

기존 HTTP 시험에 실제 KnowledgeController의 `/knowledge/answers`, AppkeyGuard, AppInfoService 서명 검증, ValidationPipe를 연결했다. DB 조회와 AWS SDK send는 합성 구현이며 실제 AWS·운영 DB를 사용하지 않는다. 시험용으로 서명한 키를 사용한다.

실제 demo/server.mjs를 별도 프로세스로 실행하여 데모 `/api/performance/run` → 인증된 RAG HTTP 라우트 → 검색·생성 → 성능 리포트 저장까지 확인했다. 각 시나리오는 요청 2개, 동시성 2다.

| 시나리오 | 성공률 | 요청 SDK 시도 p95 | 결과 |
|---|---:|---:|---|
| 정상 응답 | 100% | 3 | 검색 2 + 생성 1 |
| 생성 실패 | 0% | 5 | 검색 2 + 실패 생성 3 |
| 생성 타임아웃 | 0% | 미측정 | 메타데이터 없는 실패를 부분 합계로 표시하지 않음 |
| 잘못된 appkey | 0% | 미측정 | HTTP 401 두 건, 추가 SDK 호출 0 |

직접 HTTP 시험은 누락·잘못된 키의 401 거절, 유효 서명 키 허용도 확인한다. DB 조회는 합성이므로 DB 기반 키 회전·만료·테넌트 정책 전체의 검증을 대체하지 않는다.

## 실행과 결과

PowerShell:

```powershell
$env:RUN_DEMO_METRICS_E2E='true'
npx jest --config test/jest-e2e.json --runInBand test/aws-metrics-http.e2e-spec.ts
```

6/6 통과. 데모 프로세스 시험은 표준 11001 포트가 비어 있는지 먼저 확인하며 일반 실행에서는 opt-in으로 건너뛴다. Nest 시험 서버는 임시 포트를 사용한다. 시험 프로세스 종료와 11001 해제 확인. 린트 통과.

저장 리포트는 `demo/reports/performance-2026-09-05T06-08-56-301Z.json`, `324Z.json`, `448Z.json`, `454Z.json` 순서로 정상·실패·타임아웃·인증 거절이다(뒤 세 파일도 동일한 날짜·시각 접두사).

설정 API 시험의 POST 오기를 PUT으로 수정했다. 제품 코드 변경은 필요하지 않았다. 이전 화면 검증과 이번 실제 데모 API 검증을 함께 보존한다. 다음 단계는 실제 AWS의 소규모 성능 기준선 측정이다.
