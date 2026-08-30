# XLSX parser 교체 검증 보고서

검증일: 2026-08-30

## 변경 내용

- 알려진 prototype pollution·ReDoS 취약점이 남은 `xlsx` 0.18.5 제거
- `read-excel-file` 9.3.10으로 XLSX 읽기 경로 교체
- 대체 parser가 지원하지 않는 legacy XLS 업로드 제거
- parser 오류를 구조화된 HTTP 400 계약으로 정규화

## 처리 상한

| 항목 | 상한 |
|---|---:|
| 업로드 파일 | 기본 30MB, 설정 허용 1~100MB |
| sheet | 50개 |
| sheet당 row | 50,000개 |
| row당 column | 512개 |
| 전체 cell | 200,000개 |
| cell 문자열 | 32,767자 |

## 검증 결과

- Document parser와 파일 보안 단위 계약: 19/19 PASS
- sheet·row·column·전체 cell·cell 문자열 상한: PASS
- malformed XLSX parser 오류 정규화: PASS
- legacy XLS 거절: PASS
- 실제 PDF·DOCX·XLSX parser metadata와 검색: 6/6 PASS
- 실제 지식 전체 생명주기: 6/6 PASS
- `npm audit` High: 4건에서 3건으로 감소

잔여 High 3건은 production XLSX 처리 경로가 아니라 Prisma CLI의 `deepmerge-ts` 전이 의존성입니다.

## 호환성

CSV와 XLSX 업로드는 계속 지원합니다. legacy binary XLS 파일은 XLSX 또는 CSV로 변환한 뒤 업로드해야 합니다.
