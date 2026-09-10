# RAG 실행·색인 버전 추적 — 2026-09-05

## 구현 범위

요청 ID로 실제 모델·프롬프트·검색 설정과 검색 당시 색인을 연결한다. 재색인 또는 파일 삭제 후에도 과거 요청 로그의 snapshot은 유지된다. 공개 응답 필드와 모델에 전달하는 근거 metadata는 유지하며, 실행 정보는 서버 DB에 저장한다.

| 저장 위치 | 기록 내용 |
| --- | --- |
| `knowledge_chunk.index_provenance` | 색인 실행 UUID, 시각, 실제 다운로드 원본 SHA-256, 파서 이름·구현 버전, 청킹 버전·전략·크기·overlap, 임베딩 모델·차원·정규화, 코드 식별 정보 |
| `knowledge_query_log.execution` | 프롬프트 버전, system/출력 지시/생성 prompt 해시, 모델·임베딩 설정, 검색 limit·실효 threshold·권한 필터, 생성 설정, strict·답변 스타일, 검색 청크 ID·내용 해시·색인 snapshot, 보충 자료 ID·해시, 인용 번호, 답변 상태·종료 사유 |
| `dist/build-info.json` | 빌드 시점 Git revision, 작업 트리 변경 여부, 소스·스키마·의존성 잠금 파일 등을 포함한 SHA-256 |
| 평가 산출물 | `run-manifest.json`의 실행 UUID·데이터셋/자료/채점기 해시·case/tenant/request ID 매핑, 응답 파일의 실행/요청 ID, `server-executions.json`의 DB 실행 기록 |

색인 정보는 chunk 교체와 같은 트랜잭션에서 저장한다. 실패한 새 색인은 기존 정보도 교체하지 않는다. 과거 chunk·query row는 nullable 컬럼을 그대로 null로 유지하며 과거 버전을 추정해 채우지 않는다.

모델 응답의 answered / insufficient_evidence / invalid_model_response / incomplete_model_response를 기록한다. 모델 호출 전 근거 부족은 `modelInvoked: false`다. 검색·생성 호출 예외는 `request_failed`, `failedStage`로 기록하고 원래 예외를 다시 전달한다. DB 자체 장애로 기록할 수 없으면 서버 오류 로그를 남기며 완전한 감사 보존을 보장하지 않는다. 인증·입력 검증·설정 누락·쿼터 차단은 이 실행 로그 범위 이전이며, 기존 경계 정책을 따른다.

## 코드 식별

- `npm run build`는 컴파일 후 `scripts/stamp-build.mjs`로 식별 파일을 생성한다. 실행 프로세스는 파일을 시작 시 읽는다.
- TypeScript 개발·테스트 실행은 동일 스크립트의 읽기 전용 `--print`를 시작 시 한 번 호출한다. `build.mode`는 source/build/unknown을 구분한다.
- Git이 없는 Docker 빌드도 소스 해시는 생성한다. 이 경우 Git revision과 변경 여부는 null이다. 식별 파일이 없거나 잘못된 빌드는 unknown으로 남긴다.
- 변경된 작업 트리에서는 Git revision만으로 변경분을 설명할 수 없으므로 `workingTreeDirty`와 `sourceSha256`를 함께 비교한다. 해시는 서명이나 외부 검증 증명이 아니다.
- 실행 중 소스를 바꾼 경우 새 프로세스를 시작해야 시작 시점 식별 정보가 갱신된다. 평가기 자신의 commit을 서버 commit으로 간주하지 않는다.

## 조회 및 평가 연결

관리 권한이 있는 DB 연결에서 **tenant와 요청 ID를 함께** 조건으로 사용한다. 신규 외부 조회 API는 추가하지 않았다.

```sql
SELECT id, request_id, created_at, model_id, execution
FROM knowledge_query_log
WHERE appcode = $1 AND request_id = $2
ORDER BY created_at;
```

`execution.retrievedSources`의 1부터 시작하는 순서와 `citedSourceIndexes`를 대응한다. 보충 자료는 검색된 청크 뒤에 이어진다. 사용된 출처만 응답에 반환하는 기존 계약을 유지한다.

평가는 `evaluationRunId → manifest.requests[caseId, tenant, requestId] → server-executions.requestId`로 연결한다. 요청 실패도 전송 전에 ID를 기록하며, 서버까지 도달하지 못한 요청에는 DB 기록이 없을 수 있다. 서버 실행 기록은 합성 평가 tenant만 내보내고, S3 정리를 먼저 수행한다. 원본 산출물은 기존처럼 Git 제외 대상이다. 오프라인 재채점은 새로운 실제 실행 ID를 만들어 붙이지 않고 기존 응답의 ID를 보존한다.

추가 설정 snapshot에는 질문·답변·system prompt 원문을 복제하지 않는다. 기존 query log의 question/response 저장 정책과 보존기간 개선은 별도 잔여 작업이다.

## 검증과 적용

- 서버 build/typecheck/lint 및 단위 186개, 검증 데모 37개 통과.
- 격리 PostgreSQL에서 13개 migration 적용, 통합 24개 통과, 임시 DB 정리 완료.
- 실제 pgvector 검색의 색인 snapshot, 재색인 실패·성공·트랜잭션 롤백, tenant 격리, 문서 삭제 후 로그 유지 검증.
- 모델 호출 예외/응답 오류/근거 부족과 실효 설정 저장, 외부 응답·prompt에 내부 provenance 비노출 검증.
- 합성 로컬 HTTP 평가에서 503 실패 요청의 실행 ID 연결 검증. Git 없는 빌드의 fingerprint 생성·소스 변경 감지·`.env` 제외 검증.
- 유료 AWS 평가 및 S3 실행 기록 export의 실제 AWS 재실행은 이번 범위에서 하지 않았다. 기존 74/74 품질 실측을 새 실행 결과로 취급하지 않는다.

적용 시 `20260905090000_execution_provenance` migration을 먼저 적용하고 새 서버/워커를 시작한다. 이번 검증은 임시 DB에만 적용했다. 운영 DB·기존 로컬 서비스 DB는 변경하지 않았으며 운영 배포나 기존 문서 재색인은 수행하지 않았다. 기존 문서는 승인된 재색인 후에 새 provenance를 갖는다.

다음 작업은 단계 3의 네트워크 단절·실제 외부 의존성 장애 복구 검증이다. 장기 부하, 독립 업무 자료 검수, 개인정보 보존 정책과 `/v1` 확정도 남아 있다.
