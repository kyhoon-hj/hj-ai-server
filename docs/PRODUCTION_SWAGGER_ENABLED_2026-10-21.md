# 운영 Swagger 활성화 기록

2026-10-21 KST. 사용자의 운영 Swagger 활성화 및 페이지 열기 요청에 따라 적용했다.

## 적용 범위

- 주소: https://ai.hjshub.com/api-docs
- EC2: `i-0c6431bf77d888faf`, `ap-northeast-2`.
- 실행 릴리스: `/home/ubuntu/hj-ai-releases/20261014-console-01`.
- 앱 이미지: `hj-ai-server:20261014-console-01`.
- 이미지 ID: `sha256:a21e674afa7bece59265cd89d1ac1d6319d78370b7aff8d0906466338fbd5dc0`.
- 릴리스 `.env`의 `SWAGGER_ENABLED=false`를 `true`로 변경했다.
- 앱 전용 Compose override: `deploy/swagger-enabled-20261021.json`. 내용은 `services.app.environment.SWAGGER_ENABLED=true`이며 비밀값이 없다.
- 현재 운영 Compose 파일 조합에 위 override를 추가하고 `up -d --no-deps --no-build --pull never --force-recreate app`으로 앱만 재생성했다.
- 실행 환경변수 전체를 변경 전후 비교해 `SWAGGER_ENABLED`만 달라졌음을 확인했다. 이미지 ID와 다른 서비스 컨테이너 ID는 동일하다.
- 비활성화 종료 시각은 지정하지 않았다. 사용자가 비활성화를 요청할 때까지 유지한다.

## 백업과 복구

- 최종 적용 직전 백업: `/home/ubuntu/hj-ai-backups/swagger-20261021T025932Z`.
- 환경설정, 컨테이너 구성과 Compose 파일은 운영 서버에서 private 권한으로 보관한다. 비밀값은 문서나 Git에 기록하지 않는다.
- Swagger를 끌 때는 현재 운영 Compose 조합을 확인한 뒤 릴리스 `.env`와 앱 override의 `SWAGGER_ENABLED`를 모두 `false`로 바꾸고 같은 이미지로 앱만 재생성한다. UI와 JSON 경로의 404 및 readiness 200을 확인한다.
- 다른 프로젝트의 공유 프록시 설정과 DB 스키마는 변경하지 않았다.

## 검증 결과

2026-10-21 KST 실제 운영 origin과 공개 HTTPS 경로에서 검사했다.

| 검사 | 결과 |
|---|---|
| `/api-docs` | origin 및 공개 HTTP 200, Swagger HTML 확인 |
| `/api-docs-json` | origin 및 공개 HTTP 200 |
| `/api-docs/swagger-ui-init.js` | origin 및 공개 HTTP 200 |
| `/api-docs/swagger-ui-bundle.js` | origin 및 공개 HTTP 200 |
| `/api-docs/swagger-ui.css` | origin 및 공개 HTTP 200 |
| `/health/ready` | origin 및 공개 HTTP 200, 앱 healthy |
| OpenAPI | 64개 paths, 개발 테이블 및 비활성 레거시 Bedrock·지식 쓰기 경로 미포함 |
| `/test-tables` 무인증 | 공개 HTTP 404 |
| `/bedrock/config`, `/bedrock/models` 무인증 | 공개 HTTP 401, Swagger에는 미포함 |
| 기존 인증 환경변수 | 변경 전과 동일 |
| 운영 이미지 | 변경 전과 동일 |
| 다른 서비스 컨테이너 | ID 변경 없음 |

SDK 모델 호출, 데이터 쓰기, DB migration, 전체 회귀 테스트는 수행하지 않았다. 런타임 설정 변경에 필요한 실제 HTTP 및 구성 보존 검증으로 범위를 한정했다.

## 작업 중 확인 사항

사전 검사에서 이미지 기본 command 상속, Compose 출력의 달러 기호 이스케이프, 환경변수 배열 순서를 실제 값 변경으로 잘못 판정하는 문제가 있었다. 비교 로직을 수정하고 원래 환경변수 값의 일치 여부를 다시 확인했다. 중간 복귀 후에도 원래 인증값과 healthy 상태가 유지됨을 확인했으며 최종 적용은 성공했다.

- 최종 성공 SSM Run Command: `cedba2b7-dc59-47ff-9ea4-20225f7509fa`.
- 최초 점검: `c8c748e9-a4cd-40ce-846e-d841dfbcc571`.
- 구성 점검: `fedcbb2c-375b-49f9-96fd-217a5ebf9d80`.
- 중간 복귀 후 인증 보존 확인: `6d556276-a4bd-4ff0-84ee-a4e899284189`.
