# Upload/DB 실패 보상 검증 보고서

검증일: 2026-08-29

## 검증 범위

S3 upload가 성공한 뒤 지식 파일 DB record 생성이 실패할 때 업로드 객체를 보상 삭제하는지 검증했습니다. 운영 endpoint에 장애 주입 기능을 추가하지 않고 서비스 단위 테스트에서 DB와 S3 실패를 제어했습니다.

## 장애 주입 결과

| 경로 | 기대 결과 | 결과 |
|---|---|:---:|
| S3 성공, DB 실패 | 정확한 tenant key 보상 삭제, 원래 DB 오류 유지 | PASS |
| S3 실패 | DB create와 보상 삭제 미실행 | PASS |
| S3 성공, DB 성공 | 보상 삭제 미실행 | PASS |
| DB 실패, 보상 삭제 실패 | `KNOWLEDGE_UPLOAD_COMPENSATION_FAILED`로 orphan 위험 식별 | PASS |

모든 경로에서 multipart 임시 staging 파일 정리도 확인했습니다. 단위 테스트 결과는 4/4 PASS입니다.

## 실제 환경 회귀

- 지식 전체 생명주기: 6/6 PASS
- 6MiB streaming smoke: upload 201, download 200
- upload/download SHA-256 일치
- S3 객체 삭제 확인
- staging 파일 증감 0

## 남은 범위

보상 삭제 자체가 실패한 객체의 자동 재시도·운영 정리 절차와 archive·chunk·S3 삭제의 다단계 일관성은 `KNW-SRV-05`에서 다룹니다.
