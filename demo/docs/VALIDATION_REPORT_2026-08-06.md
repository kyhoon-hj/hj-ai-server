# 다중 형식 parser 검증 리포트

## 대상

- 검증일: 2026-08-06
- AI Server: `http://127.0.0.1:11000`
- Demo Console: `http://127.0.0.1:3200`
- fixture manifest: 2.0.0
- 실행 구성: Docker AI Server와 로컬 Demo Console

## 구현 범위

- 실제 PDF 2페이지, DOCX 본문·표, XLSX 2개 sheet fixture 추가
- setup에서 multipart 업로드, 인덱싱, PUBLIC/PUBLISHED policy 적용
- 파일 metadata와 chunk 생성 수, 형식별 고유 marker 검색을 한 번에 검증하는 6개 시나리오 추가
- XLSX 선행 제목 행 탐지와 실제 행 번호 metadata 개선
- PDF 페이지별 section과 page metadata 보존
- fixture manifest·파일 무결성 데모 단위 테스트 추가

## 결과

| suite | 결과 |
|---|---:|
| 다중 형식 parser | 6/6 PASS |
| tenant isolation | 8/8 PASS |
| RBAC | 6/6 PASS |
| credential lifecycle | 4/4 PASS |
| 운영 API 경계 | 8/8 PASS |
| HTTP 노출 보안 | 4/4 PASS |
| 공통 API 계약 | 14/14 PASS |

브라우저에서 `다중 형식 parser 검증`을 직접 실행해 6/6 결과와 console error 0건을 확인했습니다. 기존 회귀 suite도 추가 fixture가 tenant 검색과 Answer source 격리를 깨지 않음을 확인했습니다.

## 판정

`KNW-DEM-01`은 완료입니다. 현재 지원하는 정상 문서 형식의 실제 업로드·인덱싱·검색 경로는 재현 가능하게 검증됩니다. 다음 단계는 인덱싱 job의 상태·재시도·중복 실행 제어와 손상·위장·대용량 파일 안전성입니다.
