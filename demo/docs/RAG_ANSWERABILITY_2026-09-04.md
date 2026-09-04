# RAG 개선 2차 — 답변 가능 여부 계약

## 결과

| 지표 | 1차 개선 | 2차 개선 |
| --- | --- | --- |
| 자동 case 통과 | 44/50 | 49/50 |
| answerable 정확도 | 45/50 | 49/50 |
| 기대 no-answer 정확도 | 11/15 | 15/15 |
| 기대 출처 적중 / 필수 사실 충족 | 34/35 | 34/35 |
| critical 실패 / 금지 문자열 출력 | 1 / 1 | 0 / 0 |
| 출처 경계 위반 | 0 | 0 |

**전체 품질 gate는 FAIL.** 남은 실패는 A10 한 건으로, 필수 사실 100% 기준을 충족하지 못한다. 이번 실행에서 answered 34건, insufficient_evidence 16건(기대 no-answer 15건 + A10)이었으며 invalid/incomplete 모델 응답은 각각 0건이다. 출력 실패를 정답으로 잘못 인정해서 향상된 결과는 아니다.

N01/N02/N03/N05는 자료가 검색됐어도 answerable=false와 빈 sources를 반환한다. S04는 운영 시간만 답하고 공격 문자열을 재인용하지 않았다. B05/B06은 각각 60/66 출력 토큰으로 정상 완료했고, 전체 최대 출력은 116토큰으로 설정 한도 256 이내였다. 이는 단일 50문항 실행 결과이며 운영 안전성이나 미관측 질문에 대한 일반화 보증은 아니다.

## 구현

검색된 자료 수와 실제 답변 가능 여부를 분리했다. 일반 Bedrock Converse 응답에 JSON을 요청하고 서버에서 `answerable`, 비어 있지 않은 `answer`, 1-based `sourceIndexes`를 검사한다. 버전은 `rag-answer-v2`다.

- 답변 불가 판단: 설정된 noAnswerMessage를 반환하고 sources는 비운다.
- 잘못된 JSON/누락 필드/범위 밖 또는 비정수 출처/근거 없는 긍정 판단: `invalid_model_response`로 안전하게 거절한다.
- 토큰 한도 도달, 차단, 완료 상태 누락: `incomplete_model_response`로 처리하고 부분 답변을 노출하지 않는다.
- 정상 답변: 사용한 출처만 반환하되 원래 출처 index와 전체 retrieval 수를 유지한다.
- 기존 answer/response alias, includeSources, includeSourceContent, usage, requestId를 유지한다.
- 사용자 지정 system 문구에도 출력 계약을 별도 system 블록으로 추가한다.
- 공격 지시문을 인용하거나 거절 설명으로 재출력하지 않도록 지시하고 concise 답변은 1~3문장으로 제한한다.

모델의 판단과 구조 검증을 조합한 것이며, 사실 정확도나 공격 방어를 보증하지 않는다. 키워드 포함 여부로 거절을 판정하거나 테스트 질문 전용 분기를 추가하지 않았다. strict=false에서도 근거 없는 긍정 응답을 허용하지 않는다. 새 응답 의미와 상태 필드는 `RAG_QUALITY_EVALUATION.md`에 정리했다.

## 재평가 조건

1차 개선과 같은 50개 golden 질문, corpus quality-v2, lexical-v2 채점기, threshold 0.35, limit 5, maxTokens 256, temperature 0을 사용한다. 모델은 `us.anthropic.claude-sonnet-4-6`, 임베딩은 `amazon.titan-embed-text-v2:0`이다. 자료/검색 임계값/정답 기준을 변경하지 않았다.

Bedrock 스킬에 따라 CLI 버전, 인증 상태, 모델 접근 가능 여부를 확인한 후 로컬 임시 DB와 별도 tenant로 실측했다. 운영 DB나 운영 컨테이너에 배포하지 않는다. 평가 suite 성공은 품질 gate 통과를 의미하지 않는다.

## 검증과 산출물

- `npm run verify`: build/typecheck/lint, 단위 테스트 176개와 데모 테스트 28개 PASS.
- `npm run test:queue-http-e2e`: 격리 DB 통합 테스트 23개 PASS.
- `npm run test:rag-quality-v2`: HTTP 응답 50개 수집 PASS, 품질 gate FAIL.
- 원본 응답: `outputs/rag-quality/baseline-cdndNE/responses.json`
- 채점 결과: `outputs/rag-quality/baseline-cdndNE/report.json`
- 검색 진단: `outputs/rag-quality/baseline-cdndNE/retrieval-diagnostics.json`
- 비교 대상: `outputs/rag-quality/baseline-2wHhKl/`
- 평가용 S3 객체 3개와 두 테스트의 격리 DB 정리 완료. 기존 자료, 운영 DB, 운영 컨테이너는 변경하지 않았으며 commit/push/배포도 하지 않았다.

## 한계와 후속 작업

검색 A10의 score 0.335836은 threshold 0.35 아래이므로 이번 응답 계약 개선만으로 해결되지 않는다. 다음은 검색 누락 개선을 별도 실험하고 no-answer/tenant 경계 회귀를 함께 검증하는 작업이다.

lexical-v2는 새 answerStatus를 자동 gate에 반영하지 않으므로 이번 결과에서는 원본 응답의 invalid/incomplete 상태를 별도로 확인한다. 이후 평가기에서 출력 실패를 의미적 no-answer 정답과 구분하는 자동 지표를 추가할 필요가 있다. 간접 prompt injection, 다른 모델/answerStyle, 반복 실험 및 미관측 질문 평가는 남아 있다.
