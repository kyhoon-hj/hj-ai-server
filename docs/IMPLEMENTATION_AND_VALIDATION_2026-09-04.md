# 구현·검증 인수인계 — 2026-09-04

## 요약

작업 브랜치: `codex/demo-api-validation`. 이번 정리는 기존 커밋 `b496111` 이후의 서비스 화면 복구 개선, 실제 AWS 생명주기 검증, RAG 파서·응답 계약과 단계별 품질 평가를 묶는다. 로컬 PostgreSQL 이전 및 비동기 큐/lease/종료 복구 기반은 이전 커밋에 포함되어 있다.

현재는 **단계 3 장애 복원력의 잔여 검증을 유지하면서 단계 4 RAG 품질·안전성 개발 평가를 진행한 상태**다. Git 커밋/푸시는 소스 공유이며 운영 배포, 운영 DB 마이그레이션, 기존 문서 재색인을 의미하지 않는다. 원격 운영에 이번 변경이 적용되었다는 확인은 하지 않았다.

## 구현 범위

| 영역 | 구현 및 변경 |
| --- | --- |
| 서비스 데모 | upstream timeout/접속 오류 정규화, correlation ID 안내, 상태 조회 중단과 작업 실패 구분, 새 작업 제출 없이 조회 재개, 재시도 소진/영구 실패 안내, 작업 중 tenant 변경 제한 |
| CSV 파싱 | 행별 header/value section, 쉼표·인용부호·줄바꿈 처리, header/열 수와 크기 제한, 기존 structured-row 청커 연계 |
| Markdown 파싱 | `markdown-headings-v1`: ATX 제목별 section, 상위 제목 문맥·본문 없는 제목 보존, 코드 펜스 내부 제목 제외, 경로/행 metadata |
| RAG 응답 | `rag-answer-v2`: 검색 결과 수와 답변 가능 판단 분리, JSON/출처 번호/완료 상태 검증, 오류·중단 응답 안전 처리, 사용한 출처만 반환 |
| 평가 기반 | golden 50, 확장 20, 간접 공격/조건·예외 6, 추가 공격 2; 원본 자료 보존, 합성 자료 version/hash 및 응답/검색 진단 저장 |
| 채점·반복 | `lexical-v4-human-review-required`: 필수 사실·출처·no-answer·경계·출력 실패·공격 노출 검사, cohort 집계, 문항별 판정/표현/출처 변동 분리 |
| 실제 AWS 검증 | 격리 DB/tenant를 이용한 S3→queue→embedding→검색→답변 생명주기 및 평가 runner, 생성한 테스트 자원 정리 |

### API 호환성 주의

- `answerable`은 더 이상 검색 결과 존재 여부가 아니다. 모델의 근거 기반 판단과 서버 출력 검증 결과이며 사실 정확도를 보증하지 않는다.
- `answerStatus`: answered / insufficient_evidence / invalid_model_response / incomplete_model_response.
- `promptVersion`, `stopReason` 추가. answer/response alias, usage, requestId 유지.
- sources는 실제 인용된 출처만 반환하고 원래 index를 유지한다. retrieval 수와 sources 길이는 다를 수 있다.
- strict=false도 무근거 긍정 답변을 허용하지 않는다. 출력 실패와 진짜 근거 부족은 answerStatus로 구별해야 한다.
- CSV/Markdown 기존 인덱스는 자동 변경되지 않는다. 적용하려면 승인된 대상의 재색인이 필요하다.

## RAG 실측 이력

| 단계 | 결과 | 해석 / 상세 |
| --- | --- | --- |
| 최초 기준선 | 20/50, gate FAIL | 검색 누락 다수. [기준선](../demo/docs/RAG_BASELINE_2026-09-04.md) |
| CSV·매장 별칭 개선 | 44/50, gate FAIL | 출처 34/35, no-answer 11/15. [1차](../demo/docs/RAG_IMPROVEMENT_2026-09-04.md) |
| 답변 가능 계약 개선 | 49/50, gate FAIL | no-answer 15/15, A10 검색 누락 잔여. [2차](../demo/docs/RAG_ANSWERABILITY_2026-09-04.md) |
| Markdown 절 분리 | 50/50, gate PASS | A10 점수 0.335836→0.498610. [3차](../demo/docs/RAG_RETRIEVAL_2026-09-04.md) |
| 개발용 질문 확장 | 70/70, gate PASS | 기존 50 + 신규 20, 출처 47/47, no-answer 23/23. [확장](../demo/docs/RAG_EXPANSION_2026-09-04.md) |
| 간접 공격·조건/예외 | 56/56, gate PASS | 기존 50 + 신규 6, 공격 청크 인용 확인. [간접 공격](../demo/docs/RAG_ADVERSARIAL_2026-09-04.md) |
| 3유형·3회 반복 | 74/74회, gate PASS | 기준선 50 + 8문항×3회, 서로 다른 질문은 58개. [반복](../demo/docs/RAG_REPEATABILITY_2026-09-04.md) |

최신 반복 평가에서 공격 노출 9/9 확인, 표식 출력/출력 오류/출처 경계 위반은 0건이었다. 집중 8문항은 판정 변화가 없었지만 표현 변화 3문항, 인용 출처 집합 변화 1문항이 있었다. 단일 corpus 개발 표본과 3회 반복은 독립 holdout, 독립적인 사람 검수, 통계적인 실패율 보증, 포괄적 보안 인증이 아니다. 표의 여러 실행은 표본/corpus가 달라 통과 수를 합쳐 정확도로 계산하지 않는다.

## 재현 명령과 산출물

커밋 전 재검증: 서버 build/typecheck/lint 및 단위 183개 PASS, 검증 데모 35개 PASS, 서비스 데모 typecheck/lint 및 테스트 56개 PASS, 격리 DB 통합 23개 PASS(임시 DB 정리 완료). 실제 AWS 품질 평가는 위 이력의 결과를 보존했으며 문서화/푸시만을 위해 유료 평가를 다시 호출하지 않았다. 브라우저 UI 시나리오는 이전 기록을 인용한 것으로 이번 커밋 직전 재실행한 항목과 구분한다.

```text
npm run verify
npm run test:queue-http-e2e
npm --prefix service-demo run typecheck
npm --prefix service-demo run lint
npm --prefix service-demo test

# 명시적 실행: 실제 AWS 호출 비용과 테스트 S3 쓰기 발생
npm run test:aws-live-lifecycle
npm run test:rag-quality-v2
npm run test:rag-quality-extended
npm run test:rag-quality-adversarial
npm run test:rag-quality-repeatability
```

실제 평가에는 로컬 PostgreSQL, 설치된 pgvector, `.env`의 AWS/모델/버킷 설정과 유효한 권한이 필요하다. runner가 UUID 임시 DB/tenant와 임의 관리자 키를 사용하며 localhost가 아니면 중단한다. S3 테스트 객체와 DB 정리 로그를 확인해야 한다. 정상 CI의 합성 테스트 성공은 실제 모델 품질 통과를 의미하지 않는다.

실측 설정은 Sonnet 4.6 inference profile, Titan embedding v2, temperature 0, maxTokens 256, threshold 0.35, limit 5다. 상세 실행법과 판정 기준: [평가 가이드](../demo/docs/RAG_QUALITY_EVALUATION.md).

원본 응답/report/검색 진단은 로컬 `outputs/rag-quality/` 아래 있으며 Git에서 제외한다. 최신 반복 결과는 `baseline-4M04BF/`, 확장은 `baseline-rswa8l/`, 간접 공격은 `baseline-pigw0O/`다. 저장소에는 구현·합성 fixture·검증 코드·요약 보고서를 포함한다. 따라서 새 clone에 과거 원본 실행 산출물이 자동 포함되지는 않는다. `.env`, 비밀키, 로그, 브라우저 실행 산출물은 커밋하지 않는다.

## 남은 작업과 적용 순서

1. 실제 AWS 일시 장애 복구, 독립 환경·장기 부하·지연/쿼터/비용 측정 등 단계 3/5 잔여 검증.
2. prompt/model/검색/파서 설정과 코드 revision의 영속 기록. 현재 응답/평가 파일 기록만으로 운영 변경 추적을 완성한 것은 아니다.
3. 독립 검수와 실제 업무 자료로 회귀, 역할별 UX 및 `/v1` 공개 계약 확정.
4. 운영 환경·DB 버전·워커 상태·권한·백업/롤백 확인 후 별도 배포 승인. 기존 queue 변경 적용 시 구버전 워커와 혼합 실행을 피한다.
5. 승인된 문서만 재색인하고 적용 환경에서 smoke/tenant 경계/대표 질문을 재검증한다.

이번 소스 푸시로 위 운영 적용 단계가 자동 완료되거나 승인된 것은 아니다.
