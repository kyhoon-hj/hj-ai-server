# S3 streaming 검증 보고서 — 2026-08-29

## 범위

`KNW-SRV-03`의 AI Server multipart 업로드와 S3 다운로드 전송 경로를 streaming으로 전환했습니다. 업로드는 OS 임시 파일에 staging한 뒤 `@aws-sdk/lib-storage`의 multipart upload로 전송하고, 다운로드는 S3 `Body`를 HTTP 응답에 pipeline합니다.

지식 parser는 현재 Buffer 입력을 요구하므로 공개 다운로드 경로와 분리했습니다. parser용 S3 읽기는 `KNOWLEDGE_MAX_FILE_SIZE_MB`를 초과하면 stream을 폐기하는 bounded-buffer API만 사용합니다.

## 자동 검증

- AI Server: 19 suites, 85 tests PASS
- 검증 데모: 10 tests PASS
- build, typecheck, lint PASS
- staged UTF-8/JSON/signature 검증 PASS
- S3 stream 반환과 parser byte 상한·초과 stream 폐기 PASS
- staging SHA-256과 멱등 cleanup PASS

## 실제 S3 smoke

`npm run test:streaming-smoke`는 다음 흐름을 재현합니다.

1. 5MiB multipart 경계를 초과하는 Markdown fixture 생성
2. 실제 multipart 지식 파일 업로드
3. 공개 다운로드의 byte 수와 SHA-256 확인
4. `deleteObject=true`로 DB archive와 S3 object 삭제
5. 실행 전후 `hj-ai-*.upload` staging 파일 개수 비교

6MiB와 기본 30MB 제한 직전인 29MiB로 각각 실행했습니다. 두 실행 모두 upload 201, download 200, checksum 일치, S3 삭제 확인, staging 파일 증가 0건입니다.

29MiB 실행 중 AI Server Working Set은 210.29MiB에서 최대 210.42MiB였고 증가량은 0.13MiB였습니다. 이 값은 로컬 단일 실행의 관측치이며 운영 용량 산정값이 아니라 streaming 회귀의 증거로만 사용합니다.

## 안전성과 잔여 범위

- Multer는 인증 guard 이후 임의 이름의 OS 임시 파일로 수신하며 파일 1개, field 0개, part 2개와 크기 상한을 유지합니다.
- 성공, validation 실패와 S3 실패에서 staging 파일을 제거합니다. S3 multipart upload는 실패 시 미완료 part를 남기지 않도록 설정합니다.
- S3 object 업로드 성공 뒤 DB record 생성이 실패하는 보상 처리는 `KNW-SRV-04` 범위입니다.
- archive, chunk 삭제와 S3 삭제의 다단계 일관성은 `KNW-SRV-05` 범위입니다.
- 검증 데모의 `/api/upload` proxy 자체는 40MB buffer 상한을 유지하며 AI Server 운영 전송 경로와 구분합니다.
