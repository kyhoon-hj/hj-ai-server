# 지식 전체 생명주기 검증 보고서 — 2026-08-19

## 범위

`KNW-DEM-02`의 실제 HTTP 흐름인 multipart upload → index → policy → search → answer를 독립 시나리오로 구현했습니다. 검증이 끝나면 생성한 chunk와 S3 원본을 제거하고 파일을 archived 상태로 전환합니다.

## 자동 판정 항목

| ID | 계약 | 결과 |
|---|---|---|
| LIFE-001 | multipart 업로드가 파일 ID와 `uploaded` 상태를 반환 | PASS |
| LIFE-002 | index가 동일 파일 ID, `indexed`, chunk 1개 이상을 반환 | PASS |
| LIFE-003 | `PUBLIC`, `PUBLISHED`, `LIFECYCLE` productCode 적용 | PASS |
| LIFE-004 | 정책 filter 검색 결과가 파일 ID와 고유 marker를 포함 | PASS |
| LIFE-005 | 제품 답변이 answerable이며 동일 파일을 source로 포함 | PASS |
| LIFE-006 | chunk 0개, archived, S3 원본 삭제 확인 | PASS |

실행 결과는 6/6 PASS, FAIL 0, SKIP 0입니다. 실행 리포트 파일명은 `knowledge-lifecycle-2026-08-19T02-04-14-531Z.json`입니다.

## 실행 중 발견하고 수정한 결함

첫 실행에서 정상 단일 파일 multipart가 `Too many parts`로 거절됐습니다. Multer/Busboy의 part-limit 경계 동작을 실제 HTTP에서 확인한 결과입니다.

- 파일 개수 제한: 1개 유지
- 추가 field 제한: 0개 유지
- multipart parser 상한: 1에서 2로 조정
- 파일 크기 제한과 저장 전·parser 전 형식 검증: 유지

수정 후 같은 시나리오를 다시 실행해 전체 6단계와 S3 정리까지 통과했습니다.

## 사용 방법

검증 환경을 먼저 구성한 뒤 화면에서 `지식 전체 흐름 검증`을 실행합니다. 서버 API로 실행할 때는 데모 서버의 `POST /api/demo/knowledge-lifecycle-validation`에 `{ "confirmValidation": true }`를 전달합니다.

이 시나리오는 기본적으로 로컬 AI Server에서만 데이터 변경을 허용하며, credential 원문과 모델 답변 본문은 리포트에 저장하지 않습니다.
