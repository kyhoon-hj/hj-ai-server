# 실제 RAG 기준선 — 2026-09-04

## 판정: 품질 gate FAIL

실행은 완료됐으나 운영 품질 기준을 충족하지 못했다. 50개 HTTP 요청이 모두 200이었으며, 이는 정답률 100%를 의미하지 않는다. 테스트 suite PASS는 수집·정리 성공만 의미한다. 실제 평가 결과 `gatePassed`는 false이며 standalone 평가 CLI는 exit 1을 반환했다.

| 항목 | 실제 결과 | 기준/해석 |
| --- | --- | --- |
| 전체 자동 case 통과 | 20/50 (40%) | 문자열 기반 판정 |
| 기대 출처 적중 | 5/35 (14.3%) | 기준 90%, 실패 |
| answerable 정확도 | 20/50 (40%) | 기준 95%, 실패 |
| 기대 no-answer 정확도 | 15/15 (100%) | 기준 95%, 통과하나 과도한 거절 동반 |
| critical case 실패 | 4/10 | S01/S03/S04/S05의 검색 실패·과도한 거절, 공격 성공 4건이라는 의미가 아님 |
| 금지 문자열 발견 | 0건 | 제한된 문자열 검사이며 보안 인증 아님 |
| 타 tenant/미등록 출처 반환 | 0건 | 파일명 기반 검사 범위 |
| 필수 사실 case 충족 | 10/35 (28.6%) | 일반 거절 문구가 일부 matcher와 일치하는 과대평가 포함 |

## 실행 환경과 증거

- 한국 시간 2026-09-04 17:26:07~17:26:41, 순차 평가 약 33.7초.
- 로컬의 별도 UUID PostgreSQL DB에 migration 12개 적용, 신규 tenant 2개와 문서 3개만 사용. 실제 S3 업로드·Bedrock embedding·HTTP answers 경로 사용.
- answer model `us.anthropic.claude-sonnet-4-6`, embedding `amazon.titan-embed-text-v2:0`. 사전 AWS 접근 AUTHORIZED/ACTIVE 확인.
- dataset v1.0.0, fixture v2.0.0. scoreThreshold 0.35 / limit 5 / strict true / temperature 0 / maxTokens 256 유지. 통과를 위해 질문·자료·threshold를 변경하지 않았다.
- 저장소 HEAD `b496111930f7beb4815ec66034fdffa4c303c00d`, 미커밋 작업 포함. 로컬 테스트 AppModule 실행이며 원격 운영 버전 검증/배포가 아니다.
- 원본 응답: `outputs/rag-quality/baseline-yjEQvm/responses.json`
- 원본 채점: `outputs/rag-quality/baseline-yjEQvm/report.json` (dataset/scorer/fixture SHA256 포함)
- 생성 모델 호출은 5개, 나머지 45개는 검색 결과 0건으로 모델 생성 전 거절. 반환된 `modelId`만으로 생성 호출 여부를 판정하지 않았다.
- 응답 usage 합계 input 3,972 / output 1,205 tokens. embedding 사용량·비용은 이 합계에 포함하지 않음.
- A08/B07/S02는 outputTokens 256이며 답변 문장이 중간에서 끊겼다. 응답 계약에 stopReason은 없으므로 token 한도와 실제 텍스트를 근거로 판단.
- 테스트 S3 객체 3개 삭제 및 격리 DB 삭제 완료. 버전 관리 bucket의 이전 version 영구 삭제는 하지 않음. 기존 DB/운영 컨테이너 변경 없음.

## 실패 분석

### 1. 검색 단계에서 정상 질문을 지나치게 많이 거절

답변 가능 35문항 중 30개가 retrieval.count 0, answerable false였다. 상품 질문 A11~A22는 전부 여기에 포함된다. 코드의 strict 분기는 검색 결과가 없으면 모델을 호출하지 않고 정해진 no-answer 문구를 반환한다. 즉 이번 주된 실패는 모델의 사실 생성 오류보다 검색 recall 부족이다.

현재 보고서에는 탈락한 후보 점수가 없어 threshold 0.35만이 원인이라고 단정할 수 없다. 후속 작업에서 동일 corpus의 top-k 원점수, tenant/정책 필터, chunk 내용을 확인해야 한다. 단순히 threshold를 내려 no-answer 질문을 오답으로 답하게 만드는 조정은 금지한다.

### 2. 매장 명칭과 fixture 코드의 연결이 자료에 없음

질문은 성수점/마포점, 원문은 STORE_A/STORE_B로 되어 있다. B01 실제 응답은 STORE_B 정책의 14일을 인용하면서도 마포점에 해당하는지 확인할 수 없다고 명시했다. A04/B07에서도 유사한 지점 매핑 단서가 나타났다. 앱 이름만으로 이 대응이 모델 근거에 제공됐다고 볼 수 없다.

따라서 이 수치는 현 fixture 기준선으로 보존하고, 명칭 매핑을 근거 자료에 명시하는 별도 버전 또는 질문 코드 정규화 실험을 설계한다. 기존 기준선 질문을 조용히 교체하지 않는다.

### 3. 자동 채점의 의미상 한계

- B01/B07은 출처와 숫자 문자열 때문에 자동 통과했지만 실제 답변에는 매장 대응을 확인하지 못한다는 유보가 있다. 완전한 정답으로 간주하지 않는다.
- A06/A07/B05/B06/S05는 일반 거절 문구의 `없습니다`가 필수 사실 matcher와 일치했다. 전체 case는 answerable/source 실패로 거절됐지만 필수 사실 지표는 부풀려졌다.
- critical 실패 4개는 공격을 따른 사례가 아니라 기대 답변을 제공하지 못한 사례다. 검색 전 차단된 공격 질문은 모델의 injection 방어력을 검증하지 못했다.

## 다음 작업 우선순위

1. 별칭 매핑이 명시된 평가 corpus 버전을 만들고 기존 기준선과 구분.
2. 생성 없이 검색 top-k와 원점수를 진단해 상품/정책 검색 누락 원인 확인.
3. no-answer 문구가 사실 충족으로 계산되지 않도록 채점기를 version-up하고 기존 원본 응답을 오프라인 재채점.
4. 답변 길이/stopReason 계약을 검토한 뒤 동일 질문으로 비교 평가. 아직 서버 검색·prompt·모델 설정 수정은 하지 않았다.

재실행: `npm run test:rag-quality-live`. 비용이 발생하는 opt-in 명령이며 보고서는 매번 새 출력 디렉터리에 보존한다.
