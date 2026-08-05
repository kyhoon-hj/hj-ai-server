# 전체 기능 검증 매트릭스

| 영역 | 기능 | 수동 콘솔 | 자동 계약 | 성능 시험 | 추가 고도화 |
|---|---|:---:|:---:|:---:|---|
| 상태 | live/readiness | O | O | O | DB 실제 질의, S3/Bedrock 필수 설정 판정 |
| 앱 | 생성·조회·수정·삭제 | O | 관리자 인증·구성·정리 |  | 세분화된 role 확장 |
| 앱 | appkey 재발급·비활성 | O | O |  | 동시 회전 시험 |
| Bedrock | config·models | O | O |  | 외부 API에서 제거 여부 확인 |
| Bedrock | Converse | O |  | O | model allowlist·quota 시험 |
| Bedrock | text response | O |  | O | 공통 API 유지 여부 결정 |
| Bedrock | general answer | O | O | O | 위험 질문 기준 dataset 확장 |
| Storage | upload·list·detail·download | O |  |  | streaming·용량 제한 시험 |
| Knowledge | 파일 업로드 | O |  |  | PDF/DOCX/XLSX parser 회귀 |
| Knowledge | 직접 텍스트·seed | O | fixture setup |  | seed 운영 endpoint 제거 |
| Knowledge | index·reindex | O |  |  | 비동기 job·retry·중복 실행 |
| Knowledge | 정책·보관·S3 삭제 | O | cleanup |  | role 및 감사 로그 검증 |
| RAG | 검색 | O | O | O | source 적중률 자동 평가 |
| RAG | 호환 RAG 응답 | O |  | O | 제거 일정 또는 호환 보장 |
| RAG | 제품 Answer | O | O | O | `/v1/answers` 확정 |
| 공통 | validation 오류 | O | 일부 |  | DTO boundary 전체 자동화 |
| 공통 | correlation ID | O | O | O | 로그·trace 연결 검증 |
| 공통 | 관리자/appkey credential 분리 | O | O |  | 관리자 key 만료·감사 로그 |
| 공통 | platform-admin/knowledge-operator RBAC | O | 6/6 |  | legacy 지식 쓰기 경로 폐기 |
| 공통 | tenant isolation | O | 파일·목록·검색·답변 source 8/8 |  | source 품질·근거 정확도 평가 |
| 공통 | rate/token/storage quota | 수동 |  | O | 원자적 quota·429 계약 |

## 합격 기준 초안

- tenant 간 데이터 노출 0건
- 인증 우회 0건
- 예상하지 않은 5xx 0.5% 이하
- correlation ID 누락 0건
- 비 AI API p95 500ms 이하
- vector 검색 p95 1.5초 이하
- RAG 전체 p95 10초 이하
- RAG 예상 source 적중률 90% 이상
- strict no-answer 판정 정확도 95% 이상

수치는 staging 기준값을 수집한 뒤 실제 SLO로 확정합니다.
