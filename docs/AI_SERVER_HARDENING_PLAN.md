# AI Server 실서비스 고도화 계획

## 목표

데모가 발견한 문제를 반복 가능한 테스트로 전환하고, 외부 앱 공통 API가 보안·안정성·성능 SLO를 만족하도록 개선합니다.

## P0: 외부 노출 전 필수

- [x] AppInfo platform-admin과 지식 운영자 admin API 역할 RBAC 적용
- [x] 외부 appkey와 관리자 credential 분리 및 startup 검증
- [x] appkey 만료·제한된 grace 회전, 관리자 이중 키 교체와 보안 감사 이벤트
- [x] `test-tables`, demo seed, config/models·legacy 지식 쓰기 endpoint 운영 기본 차단
- [x] appkey secret 기본값 제거 및 startup 환경 검증
- DB migration preflight와 배포 절차 확정
- 모든 Bedrock 호출에 model allowlist와 명시적 maxTokens 적용
- 외부 소비자 API 공통 rate limit·동시성·월 token quota 적용
- Multer 단계 file size/field 제한 적용
- S3 업로드·다운로드 streaming 전환
- [x] exact-origin CORS allowlist와 운영 Swagger 기본 비활성화
- high dependency vulnerability 해소

## P1: 안정성 및 운영

- live/readiness endpoint 분리
- DB, S3, Bedrock dependency readiness 구현
- graceful shutdown 및 connection drain
- AWS SDK adaptive retry와 retryable 오류 분류
- 요청 timeout 및 abort 전파
- 인덱싱을 queue 기반 비동기 job으로 전환
- chunk embedding 동시성 제한과 부분 실패 재시도
- quota 확인과 사용량 기록을 원자적으로 처리
- 구조화 로그, metrics, distributed trace, alert 추가
- 질문·응답 로그의 PII 마스킹, 암호화, 보존기간 적용

## P2: 품질과 비용

- RAG golden dataset과 source 적중률 측정
- no-answer 및 hallucination 평가
- chunk 크기·overlap A/B 검증
- prompt version 및 model version 고정
- 모델별 latency·token·품질 비교
- CloudWatch `InvocationThrottles`, `InputTokenCount`, `OutputTokenCount`, `InvocationLatency` 모니터링
- 실제 출력 token p95를 기준으로 maxTokens 조정
- 필요 시 geographic cross-region inference profile 검토

## 완료 조건

- 데모 전체 계약 suite PASS
- tenant isolation 자동 시험 PASS
- migration rollback/redeploy 리허설 완료
- dependency audit high 0건 또는 승인된 예외
- staging 성능 SLO 달성
- 429, timeout, Bedrock 장애에서 정의된 오류 계약 유지
- 운영 dashboard와 alert runbook 준비
