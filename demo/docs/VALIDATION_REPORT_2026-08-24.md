# 지식 파일 multipart 거절 계약 검증 보고서 — 2026-08-24

## 범위

`KNW-DEM-04`의 실제 HTTP 경계를 검증했습니다. 대상은 `POST /admin/v1/knowledge/apps/:appId/files`이며, 모든 요청은 검증 데모가 생성한 multipart 요청으로 AI Server에 전달했습니다.

## 자동 판정 항목

| ID         | 계약                                          | 결과 |
| ---------- | --------------------------------------------- | ---- |
| REJECT-001 | 확장자와 MIME이 불일치한 위장 파일은 HTTP 400 | PASS |
| REJECT-002 | signature가 손상된 PDF는 HTTP 400             | PASS |
| REJECT-003 | signature가 손상된 DOCX는 HTTP 400            | PASS |
| REJECT-004 | signature가 손상된 XLSX는 HTTP 400            | PASS |
| REJECT-005 | 0 byte 파일은 HTTP 400                        | PASS |
| REJECT-006 | 공백만 있는 문서는 HTTP 400                   | PASS |
| REJECT-007 | 30MB 제한을 1 byte 초과한 파일은 HTTP 413     | PASS |

각 항목은 HTTP 상태와 함께 구조화 응답의 `statusCode`, `code`, `requestId`, 응답 헤더의 `x-correlation-id`를 검사합니다. 400 응답의 코드는 `VALIDATION_ERROR`, 413 응답의 코드는 `PAYLOAD_TOO_LARGE`이며 `requestId`와 헤더 값이 일치해야 합니다.

실행 결과는 7/7 PASS, FAIL 0, SKIP 0입니다. 실행 리포트 파일명은 `knowledge-file-rejection-2026-08-24T00-54-41-698Z.json`입니다.

## 안전성과 정리

모든 fixture는 저장 전에 거절되므로 DB record와 S3 object를 만들지 않습니다. 대용량 fixture는 `KNOWLEDGE_MAX_FILE_SIZE_MB`와 같은 제한값을 사용해 메모리에서 생성하며 리포트에는 파일명, byte 수, 상태와 오류 계약만 남깁니다. 파일 본문과 credential은 기록하지 않습니다.

## 사용 방법

검증 환경을 먼저 구성한 뒤 화면에서 `지식 파일 거절 검증`을 실행합니다. 서버 API로 실행할 때는 검증 데모의 `POST /api/demo/knowledge-file-rejection-validation`에 `{ "confirmValidation": true }`를 전달합니다.

이 시나리오는 기본적으로 로컬 AI Server에서만 실행됩니다. AI Server와 검증 데모가 서로 다른 환경 설정을 사용하는 경우 양쪽의 `KNOWLEDGE_MAX_FILE_SIZE_MB`를 동일하게 설정해야 합니다.
