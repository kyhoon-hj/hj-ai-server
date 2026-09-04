# RAG 개선 3차 — Markdown 절 단위 검색

## 결과

| 지표 | 2차 개선 | 3차 개선 |
| --- | --- | --- |
| 자동 case 통과 | 49/50 | 50/50 |
| 출처 적중 / 필수 사실 충족 | 34/35 | 35/35 |
| 기대 no-answer 정확도 | 15/15 | 15/15 |
| critical 실패 / 금지 문자열 / 출처 경계 위반 | 0 / 0 / 0 | 0 / 0 / 0 |
| 품질 gate | FAIL | PASS |

A10의 정확한 정책 절 score가 0.335836에서 0.498610으로 상승하여 기존 threshold 0.35를 통과했다. 실제 응답은 “등록 자료에서 확인되지 않는 내용은 추측하지 않고 고객센터 확인을 안내합니다.”였다. 답변 가능 35건과 근거 부족 15건으로 분류됐고 invalid/incomplete 응답은 0건이다. 최대 출력은 112토큰이었다.

## 검증과 산출물

- `npm run verify`: build/typecheck/lint, 단위 183개, 데모 28개 PASS.
- `npm run test:queue-http-e2e`: 격리 통합 23개 PASS.
- `npm run test:rag-quality-v2`: 50개 HTTP 응답 수집 및 품질 gate PASS.
- 원본 응답/채점/검색 진단: `outputs/rag-quality/baseline-innbBc/`의 `responses.json`, `report.json`, `retrieval-diagnostics.json`.
- 비교 기준: `outputs/rag-quality/baseline-cdndNE/`.
- 평가 S3 객체 3개 및 두 테스트의 격리 DB 정리 완료.
- 평가 시작 후 보강한 제목-only 절 보존은 평가 fixture의 본문/청크를 바꾸지 않으며 최종 단위 테스트로 검증했다.

## 변경 범위

Markdown 파일을 전체 텍스트 한 section으로 처리하던 경로에 `markdown-headings-v1` 파서를 추가했다. ATX 제목(`#`~`######`)별로 section을 만들고 상위 제목을 본문 앞에 보존한다. 본문이 없는 상위 제목은 하위 절 문맥으로 사용하고, 본문이 없는 독립/마지막 제목도 유실하지 않는다.

코드 펜스 내부 제목은 분리하지 않는다. BOM/CRLF, 닫는 제목 표식, 서문, 중첩 제목, 여러 최상위 제목을 처리한다. `headingPath`, `startLine`, `endLine`, parser 버전을 metadata에 기록하며 각 section은 기존 길이/overlap 청커를 통과한다. TXT/CSV/PDF/DOCX 경로 및 검색 SQL/정책 필터는 변경하지 않았다.

## 실험 조건

- 동일 corpus quality-v2, golden 질문 50개, lexical-v2 채점기.
- threshold 0.35, limit 5, maxTokens 256, temperature 0 유지.
- 응답 prompt `rag-answer-v2` 유지.
- `us.anthropic.claude-sonnet-4-6` / `amazon.titan-embed-text-v2:0` 유지.
- 정답이나 자료의 사실 문구를 수정하지 않았고 질문별 예외 코드를 추가하지 않았다.
- Bedrock 스킬의 인증/모델 접근 사전 확인 후, 자체 PostgreSQL RAG의 격리 DB/tenant에서 재색인·평가했다. 관리형 Bedrock Knowledge Base나 신규 AWS 인프라를 생성한 작업이 아니다.

## 적용 및 한계

기존 인덱스는 자동으로 변경되지 않는다. 적용하려면 대상 Markdown 문서를 재색인해야 하며, 이번에는 평가용 문서만 색인했다. 운영 배포, 기존 문서 재색인, commit/push는 하지 않았다.

이 파서는 전체 CommonMark AST 파서가 아니다. Setext 제목과 blockquote/list 내부 제목은 절 분리 대상으로 삼지 않는다. 상위 제목은 보존하지만 상위 본문 조건이나 다른 절의 예외를 자동으로 붙이지 않는다. 긴 section은 기존 청커가 다시 분할하므로 후속 청크의 문맥 보강은 별도 과제다. 절이 많아지면 임베딩 호출 및 저장량도 증가할 수 있다.

50문항은 이미 사용한 개발/회귀 표본이다. 단일 실행 통과를 운영 품질·보안 인증으로 확대 해석하지 않는다. 다음은 미관측 질문, 절 사이 조건/예외 결합 질문, 간접 injection, 반복 평가를 추가하는 작업이다.
