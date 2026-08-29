# Archive·chunk·S3 삭제 일관성 검증 보고서

검증일: 2026-08-29

## 변경 계약

1. DB transaction에서 지식 파일을 `archived`로 변경하고 관련 chunk를 원자적으로 삭제합니다.
2. 외부 객체 삭제 요청은 `objectCleanupStatus=pending`으로 기록한 뒤 S3 삭제를 수행합니다.
3. S3 성공은 `completed`, 실패는 오류 이름과 함께 `failed`로 기록합니다.
4. `failed` 요청은 같은 `deleteObject=true` 호출로 재시도할 수 있습니다.
5. 이미 `completed`인 요청은 S3를 다시 호출하지 않습니다.

S3 삭제는 DB transaction이 성공한 뒤에만 수행되므로 DB rollback 이후 외부 객체만 사라지는 순서를 제거했습니다. S3 성공 후 완료 상태 기록이 실패한 경우에는 `KNOWLEDGE_OBJECT_CLEANUP_STATE_FAILED`로 구분하며, S3 DeleteObject의 멱등성을 이용해 같은 요청으로 회복합니다.

## 장애 주입 결과

| 경로 | 기대 결과 | 결과 |
|---|---|:---:|
| 정상 archive·삭제 | DB transaction commit 후 S3 삭제와 완료 기록 | PASS |
| DB transaction 실패 | S3 미호출 | PASS |
| S3 삭제 실패 | archived 유지, cleanup `failed`, 구분 오류 | PASS |
| 완료 상태 기록 실패 | 구분 오류 후 동일 요청 재시도 가능 | PASS |
| 이미 완료된 요청 재호출 | S3 중복 호출 없음 | PASS |
| 이전 S3 실패 요청 재호출 | cleanup `completed`, 이전 오류 제거 | PASS |

단위 테스트 결과는 6/6 PASS입니다. 운영 endpoint에는 장애 주입 기능을 추가하지 않았습니다.

## 실제 환경 회귀

- 지식 전체 생명주기: 6/6 PASS
- cleanup 결과: `status=archived`, chunk 0, `deletedObject=true`
- 6MiB streaming smoke: upload 201, download 200, SHA-256 일치
- S3 객체 삭제 및 staging 파일 증감 0 확인

## 남은 범위

현재 재시도는 동일 API 요청을 다시 호출하는 방식입니다. 주기적으로 `failed` 또는 장시간 `pending` 상태를 회수하는 cleanup worker와 중앙 감사 이벤트는 후속 운영 고도화 범위입니다.
