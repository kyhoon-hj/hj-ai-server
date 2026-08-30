# Reindex·cleanup 중복 실행 검증 보고서

검증일: 2026-08-30

## 범위

기존 upload → index → policy → search → answer → cleanup 생명주기를 reindex와 cleanup 중복 실행을 포함한 10단계 실제 HTTP 시나리오로 확장했습니다.

## 자동 판정 항목

| ID | 계약 | 결과 |
|---|---|:---:|
| LIFE-001 | multipart 업로드가 `uploaded` 파일을 반환 | PASS |
| LIFE-002 | 최초 index가 `indexed`, chunk 1개 이상을 반환 | PASS |
| LIFE-003 | PUBLIC·PUBLISHED·productCode 정책 적용 | PASS |
| LIFE-004 | 정책 filter 검색에서 고유 marker 확인 | PASS |
| LIFE-005 | 제품 답변 source에서 동일 파일 확인 | PASS |
| LIFE-006 | reindex 후 최초 index와 같은 chunk 수 유지 | PASS |
| LIFE-007 | reindex 중복 실행 후 같은 chunk 수 유지 | PASS |
| LIFE-008 | 중복 reindex 후 정책 filter 검색 결과 유지 | PASS |
| LIFE-009 | archive, chunk 0, S3 cleanup 완료 | PASS |
| LIFE-010 | cleanup 중복 실행 후 archive·S3 완료 상태 유지 | PASS |

결과는 10/10 PASS, FAIL 0, SKIP 0입니다. 실행 리포트는 `knowledge-lifecycle-2026-08-30T00-44-18-976Z.json`입니다.

## 멱등성 증거

- 최초 index, 첫 reindex, 두 번째 reindex의 chunk 수: 모두 1
- 두 cleanup 응답의 `status`: `archived`
- 두 cleanup 응답의 chunk 수: 0
- 두 cleanup 응답의 `archivedAt`: `2026-08-30T00:44:18.669Z`로 동일
- 두 cleanup 응답의 `deleteObjectRequested`: `true`
- 두 cleanup 응답의 `deletedObject`: `true`
- 두 cleanup 응답의 `objectCleanupStatus`: `completed`

시나리오 버전은 `2.0.0`으로 올렸습니다. 첫 cleanup이 일시적으로 실패하면 LIFE-010 호출은 동일 API를 통한 실제 복구 재시도로 동작합니다.
