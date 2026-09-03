# 지식 정책 matrix 검증 보고서

- 실행일: 2026-08-31
- 작업: `KNW-DEM-05`
- 대상: 로컬 AI Server `http://127.0.0.1:11000`
- 시나리오 버전: `1.0.0`
- 실행 리포트: `knowledge-policy-matrix-2026-08-31T02-43-42-604Z.json`
- 결과: **17/17 PASS, FAIL 0, SKIP 0**

## 검증 범위

1. 테스트 문서를 기본 `INTERNAL/DRAFT` 상태로 업로드하고 인덱싱
2. `PUBLIC/DRAFT` 문서의 DRAFT 포함과 PUBLISHED 제외
3. 미래 `effectiveFrom` 문서 제외
4. 현재 유효 기간과 productCode 일치 문서 포함
5. productCode 불일치 문서 제외
6. 지난 `effectiveTo` 문서 제외
7. RETIRED 문서의 PUBLISHED 제외
8. PUBLIC 전용 앱의 INTERNAL 문서 차단
9. 검증 파일 chunk와 S3 원본 정리

검색은 고유 marker와 파일 ID로 판정해 다른 fixture의 검색 결과와 분리했습니다. 모든 포함·제외 조건은 PostgreSQL vector 검색 경로에서 실제 HTTP 요청으로 확인했습니다.

## 정리 결과

- 파일 상태: `archived`
- 남은 chunk: 0
- S3 정리 상태: `completed`

검증 중 생성한 파일은 정확한 파일 ID로 정리했으며 기존 STORE_A/B fixture와 사용자가 등록한 문서는 유지했습니다.
