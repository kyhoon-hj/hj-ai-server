# RAG 확장 평가 — 개발용 70문항

## 결과

| 구분 | 결과 |
| --- | --- |
| 기존 baseline | 50/50 통과 |
| 신규 expansion | 20/20 통과 |
| 전체 / 품질 gate | 70/70 / PASS |
| 기대 출처 / 필수 사실 | 47/47 / 47/47 |
| 기대 no-answer | 23/23 |
| critical 실패 / 금지 문자열 / 출처 경계 위반 / 모델 출력 실패 | 모두 0건 |

원본 응답을 추가로 읽어 E01/E03/E12의 서로 다른 정책 절 결합, E04/E05/E11의 상품별 가격·위치·수량 연결, E02/E06/E07/E09/E10의 조건·예외 적용을 확인했다. E13~E20은 빈 sources와 답변 불가 안내를 반환했다. 이 검토는 에이전트의 제한적 원문 검토이며 독립적인 사람 검수나 의미적 정확도 인증은 아니다.

산출물은 `outputs/rag-quality/baseline-rswa8l/`의 `report.json`, `responses.json`, `retrieval-diagnostics.json`이다. 보고서에는 데이터셋/채점기/자료 hash와 각 cohort 결과가 포함된다. 평가용 S3 객체 3개와 두 테스트의 격리 DB는 정리 완료했다. 운영 DB, 운영 컨테이너, 기존 문서 인덱스는 변경하지 않았고 commit/push/배포도 하지 않았다.

다음은 source 내부 간접 injection, 별도 corpus의 상위 조건/하위 예외 연결, 반복 실행 변동성 및 독립 검수다. 현재 단일 개발 표본 통과만으로 운영 배포 승인을 대신하지 않는다.

## 범위와 동결 기준

기존 golden 50문항을 수정하지 않고 `demo/fixtures/rag-expansion.json`의 20문항을 덧붙였다. 확장 버전은 `expansion-1.0.0`이며 처음 모델 응답을 수집하기 전에 질문/기대값/근거를 정했다. 서버 검색·청킹·프롬프트는 3차 개선 상태를 유지했다.

확장 구성은 답변 가능 12개(절 결합 3, 조건/예외 5, 상품 행 결합 3, 상황 적용 1), 답변 불가 8개(미등록 조건 5, tenant 경계 2, 내부정보 1)다. E01/E03/E12는 운영 시간과 다른 정책 절을 결합하고 E04/E05/E11은 서로 다른 상품 행을 요구한다. E02/E06/E07/E09/E10은 기본 조건과 예외 적용을 확인한다.

이 질문들은 기존 실패 분석 이후 같은 개발자가 작성했다. 개발 코드에 아직 사용하지 않았던 새 질문이지만 독립적으로 수집한 블라인드 holdout이나 사용자 현장 표본은 아니다. 결과를 확인한 뒤 이 표본으로 튜닝하면 이후에는 일반 회귀 표본으로 취급한다.

## 실행

`npm run test:rag-quality-extended`

로컬 임시 DB, 별도 tenant와 기존 합성 자료 3개를 사용한다. Bedrock 스킬에 따라 인증과 모델 접근을 확인하고 실행했다. 입력은 quality-v2, threshold 0.35, limit 5, maxTokens 256, temperature 0, prompt `rag-answer-v2`로 고정했다. 모델은 `us.anthropic.claude-sonnet-4-6`, 임베딩은 `amazon.titan-embed-text-v2:0`이다. 임베딩 진단 요청도 질문당 한 번 수행한다.

CLI 단독 검증은 `RAG_EVAL_DATASET=extended`, `RAG_EVAL_CORPUS=quality-v2` 환경에서 `node demo/scripts/rag-quality.mjs --validate`로 가능하다. 기존 명령은 50문항을 유지하고 새 명령만 70문항을 실행한다. 복합 질문의 `evidenceSpans` 각 문장이 허용된 출처에 존재하는지 검사한다.

## 채점기 보강

검증: build/typecheck/lint, 단위 183개 PASS. 추가 CLI 선택/복합 근거/오류 채점 테스트를 포함한 데모 31개 PASS. 기존 격리 DB 통합 23개 PASS.

`lexical-v3-human-review-required`는 `invalid_model_response`와 `incomplete_model_response`를 모델 출력 실패로 별도 집계하고 gate에서 거절한다. 따라서 이런 응답의 기본 거절 문구가 no-answer 정답으로 인정되지 않는다. 기존 필수 사실/출처/답변 불가 기준은 완화하지 않았다. 직전 50/50 원본을 v3로 재채점해도 50/50과 gate PASS가 유지된다.

보고서 `cohorts`에 baseline 50과 expansion 20의 통과 수 및 실패 ID를 분리한다. 합산 성공률만으로 확장 질문의 실패가 가려지지 않도록 두 결과를 함께 검토한다. 현재 cohort는 요약이며 전체 gate와 별개의 cohort gate를 구현한 것은 아니다.

문자열 채점은 사실 간 관계·부정의 범위·누락된 예외를 완전히 검증하지 못한다. 특히 상품별 가격/수량의 연결이 뒤바뀌어도 필수 단어 집합은 일치할 수 있으므로 복합 질문의 원본 답변을 별도로 검토해야 한다. 이 실험에는 source 내부 간접 injection이나 새로운 corpus를 추가하지 않았다.
