# 다중 형식 parser 검증 및 개선 기록

## 목적

AI Server가 실제 PDF, DOCX, XLSX 바이너리를 업로드부터 S3 저장, text 추출, chunk 생성, Bedrock embedding, 검색까지 처리하는지 반복 검증합니다. 데모 전용 검증 코드는 `demo`에 두고 서버 parser 개선 사항과 잔여 위험은 이 문서에서 관리합니다.

## 반영한 서버 개선

- PDF는 페이지별 section을 만들고 `pageNumber`, `pageCount` metadata를 보존합니다.
- DOCX는 Mammoth로 본문과 표의 text를 추출합니다.
- XLSX는 첫 행을 무조건 header로 가정하지 않고, 제목·설명 행 뒤 최초 tabular row를 header로 탐지합니다.
- XLSX section metadata의 `sheetName`, `headerRowNumber`, `rowNumber`는 실제 workbook 위치를 가리킵니다.
- 빈 header와 중복 header는 안정적인 key로 정규화하며 cell 값은 안전하게 문자열로 변환합니다.
- PDF parser resource는 성공·실패와 무관하게 정리합니다.

## 자동 검증 계약

`demo/fixtures/manifest.json` 2.0.0을 기준으로 다음 fixture를 사용합니다.

| 형식 | parser | 구조 검증 | 검색 marker |
|---|---|---|---|
| PDF | `pdf-parse` | 2개 page section과 page metadata | `PDF-RMA-4827` |
| DOCX | `mammoth` | 본문과 table text | `DOCX-PAIR-7319` |
| XLSX | `xlsx` | 2개 sheet, header 4행, data 5행부터 총 6개 section | `XLSX-SVC-882` |

데모의 `다중 형식 parser 검증`은 파일별 metadata/chunk 계약 3건과 실제 검색 3건을 실행합니다. fixture 파일 존재·manifest 일치는 `demo/test/fixture-manifest.test.mjs`에서 별도로 검사합니다.

## 2026-08-19 결과

- parser 및 파일 안전성 회귀: 정상 fixture와 위장·빈 파일·손상 파일·크기 제한 PASS
- AI Server unit: 77/77 PASS
- 기존 계약 회귀: tenant 8/8, RBAC 6/6, credential 4/4, 내부 경계 8/8, HTTP 노출 4/4, 공통 계약 14/14 PASS
- 로컬 대상: `http://127.0.0.1:11000`, demo: `http://127.0.0.1:3200`

## 잔여 위험과 다음 작업

- DOCX는 heading/table 의미 구조와 페이지 위치를 별도 metadata로 보존하지 않습니다.
- PDF 표는 의미 있는 행·열 구조로 복원하지 않고 페이지 text로 처리합니다.
- XLS/XLSX의 수식, macro, image, 병합 cell 의미는 보장하지 않습니다.
- 인덱싱은 아직 비동기 job 상태, idempotency, chunk별 retry와 부분 실패 복구 계약이 없습니다.
- 확장자 위장, 빈 문서, 손상 문서와 buffer 크기 제한은 서버 회귀로 검증했습니다. 실제 multipart HTTP 응답과 압축 해제 총량 제한은 `KNW-DEM-04`, `KNW-SRV-06`에서 계속 검증합니다.
