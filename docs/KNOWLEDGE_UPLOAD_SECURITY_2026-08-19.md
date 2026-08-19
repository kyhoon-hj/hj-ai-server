# 지식 파일 업로드 안전성 개선 기록

## 범위

2026-08-19 기준 `KNW-SRV-01`, `KNW-SRV-02`를 완료하고 `KNW-DEM-04`, `KNW-SRV-06`의 1차 방어선을 구현했습니다. 대상은 legacy 지식 업로드와 관리자 지식 업로드이며, 일반 S3 파일 API의 허용 형식 정책은 별도 범위로 유지합니다.

## 반영 내용

- 두 지식 업로드 route의 Multer 수신 단계에 파일 1개, field 0개, multipart parser 상한 2개와 파일 크기 제한을 적용했습니다. 실제 단일 파일 multipart가 Busboy의 part-limit 경계에서 거절되지 않는 값입니다.
- `KNOWLEDGE_MAX_FILE_SIZE_MB` 기본값은 30MB이며 환경 설정 허용 범위는 1~100MB입니다.
- controller를 우회하는 내부 호출도 동일한 실제 buffer 길이 제한을 적용합니다.
- 저장 전과 S3 다운로드 후 parser 진입 전에 파일명, 허용 확장자, MIME, binary signature를 교차 검증합니다.
- PDF header, XLS OLE header, DOCX/XLSX ZIP container marker를 검증하고 OOXML의 `word/`와 `xl/` 구조를 구분합니다.
- text 계열은 NUL, 잘못된 UTF-8, 빈 내용이 거절되며 JSON은 문법까지 검증합니다.
- XLSX parser는 formula/HTML/style/VBA 읽기를 끄고 최대 50개 sheet, 전체 200,000개 cell로 처리 범위를 제한합니다.

## 자동 검증

- 정상 UTF-8 JSON 및 기존 PDF/DOCX/XLSX fixture
- 확장자와 MIME 불일치
- DOCX를 XLSX로 위장한 OOXML
- PDF와 OOXML signature 손상
- 빈 파일과 공백 파일
- 잘못된 UTF-8과 JSON
- 경로를 포함한 파일명
- controller 제한을 우회한 크기 초과 buffer
- 환경변수 허용 범위

검증 결과:

- `npm run verify`: PASS
- AI Server: 17 suites, 77 tests PASS
- validation demo: 6 tests PASS

## 잔여 위험과 다음 작업

- 현재 OOXML 검증은 ZIP entry 이름과 container marker 기반의 1차 검증입니다. 압축 해제 총량과 처리 시간의 강제 격리는 아직 없습니다.
- `xlsx` 패키지의 알려진 취약점은 남아 있으므로 `KNW-SRV-06`은 완료 처리하지 않습니다. 안전한 parser 교체 또는 worker 격리가 필요합니다.
- S3 업로드와 다운로드는 여전히 전체 buffer 방식입니다. `KNW-SRV-03`에서 streaming으로 전환해야 단계 2의 memory exit gate를 충족합니다.
- `KNW-DEM-04`의 서버 회귀는 확보했지만 실제 multipart HTTP에서 413/400 응답 계약을 확인하는 validation demo scenario가 남았습니다.
