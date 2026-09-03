# 비동기 지식 인덱싱 job 검증 보고서

- 검증일: 2026-08-31
- 대상: `REL-SRV-01`, `REL-SRV-05`, `REL-SRV-06`, `REL-DEM-01`, `REL-DEM-04`, `REL-SVC-01~03`
- 결과 파일: `demo/reports/knowledge-index-job-2026-08-31T04-40-24-504Z.json`

## 결과

- 총 5개 항목: 5 PASS, 0 FAIL, 0 SKIP
- 새 문서 업로드 후 비동기 작업 제출: PASS
- 동일 `Idempotency-Key` 재요청 시 동일 job ID 반환: PASS
- 관찰 상태: `queued → processing → completed`
- 최종 attempt: 1
- 검증 파일, 검색 chunk, S3 원본 정리: PASS

## 추가 확인

- 실제 서비스 BFF에서 기존 XLSX 재인덱싱을 제출해 동일한 상태 흐름과 완료를 확인했습니다.
- 서비스 데모 API 응답은 appcode, idempotency key, 내부 오류 메시지를 제거합니다.
- 실패 작업은 남은 시도 횟수가 있을 때만 화면에서 재시도할 수 있습니다.

## 다음 검증

Bedrock 429·timeout·5xx와 S3 없음·DB 오류·embedding 부분 실패를 강제로 발생시켜 자동 재시도 대상과 영구 실패를 구분합니다.
