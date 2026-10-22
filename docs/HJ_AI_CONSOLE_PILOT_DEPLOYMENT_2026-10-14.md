# HJ AI Console 운영 pilot 배포 및 실계정 검증

검증일: 2026-10-14 · 대상: HJ_AI_Server · 운영 주소: https://ai.hjshub.com/console

## 결과와 공개 범위

운영 AI Server와 Console Web/BFF를 배포하고 운영 Works의 HJ Solution OWNER 계정으로 실제 SSO 로그인에 성공했다. 화면에 HJ Solution과 권영훈이 표시되며 홈·앱·사용량·감사 조회, Console 로그아웃, Works 세션을 이용한 재로그인을 확인했다. 이는 지정 조직·사용자 pilot 결과이며 M5~M7 전체 완료를 뜻하지 않는다.

등록된 Console 조직 1개, ACTIVE/OWNER membership 1개, 승인 permission 10개다. 기존 운영 앱 8개와 지식 파일 23개는 유지했다. 최초 배포 시 ownership을 자동 배정하지 않아 Console 앱은 0개였으며, 이후 사용자가 **8개 모두 HJ Solution 배정**을 명시해 ownership 8개를 등록했다. 재로그인 후 앱 8개·STORE_A 기존 지식 파일 5개와 indexed 상태·Key 메타데이터·조직 사용량·요청 로그를 실제 브라우저에서 확인했다. Playground 신규 실행과 지식 업로드 전체 여정은 별도 검증 대상이다.

## 배포 식별과 복구 자료

| 항목 | 적용값 |
| --- | --- |
| Release | `20261014-console-01` |
| 서버 | EC2 `i-0c6431bf77d888faf`, `ap-northeast-2` |
| Release 디렉터리 | `/home/ubuntu/hj-ai-releases/20261014-console-01` |
| 이미지 | `sha256:a21e674afa7bece59265cd89d1ac1d6319d78370b7aff8d0906466338fbd5dc0` |
| 소스 기준 | `006bdcbf4ad8c1e52f91e7f5e16399220f21fc12` + 미커밋 작업본 581개 파일 |
| 소스 manifest SHA-256 | `5662f8ab37ec98644423c09aa29c1ed76d63b8bdeb6d11d85890f6e724bffa9f` |
| build archive SHA-256 | `d2eb831c0296699f4cce5f68682119499ed5c0d4d84c03a0b3c1b55563a99f63` |
| 기존 이미지/복구 태그 | `sha256:dc79f7d2a06e38c8dc9ebd5765bcebd72df94194509d3fb2b280747b3287c8d5`, `hj-ai-server:rollback-20261014-console-01` |
| Backup 디렉터리 | `/home/ubuntu/hj-ai-backups/20261014-console-01` |
| DB dump SHA-256 | `731b33197d4083261dbfb02bcef259e43c09912ec83c957978bd1cdd2854a8da` |
| Secret | SSM SecureString `/hj-ai-server/console/works-client-secret/20261014-console-01`, Version 1 |

백업에는 DB custom dump, 기존 이미지 태그·container 설정·Compose 파일·Nginx 원본과 `rollback.compose.json`이 있다. 설정 파일에는 비밀값이 포함되므로 private 권한으로 보관하고 출력·Git 등록하지 않는다. SSM 값은 배포 시 복호화해 release `.env`에 주입했으며 지속적인 자동 갱신 연결은 아니다.

build archive는 Dockerfile 소유권 수정까지 포함한다. 이후 외부 배포 설정 `deploy/compose.console.yml`의 Console listen 명령을 `0.0.0.0:11003`으로 수정해 운영 release에도 적용했다. 이 설정 수정은 동일 이미지 재빌드 없이 적용했으며 현재 저장소의 Compose 예시에 반영했다. 이미지 내부의 build snapshot과 운영 외부 Compose 설정을 구분한다.

## 적용과 검증

1. 운영 `hj-ai` DB dump를 만들고 `pg_restore --list`를 검증했다. 별도 `hj_ai_console_rehearsal_20261014` DB에 복원해 migration 17→26, 기존 앱 8·파일 23 보존을 확인했다.
2. 새 이미지로 readiness·기존 관리자 API·Console 비인증 거절·Works login redirect를 시험했다. 이전 이미지도 migrated rehearsal DB에서 readiness와 기존 관리자 API에 성공했다. 실제 운영 DB 역migration이나 DB 복구는 실행하지 않았다.
3. 운영 DB에 additive migration 9개를 적용하고 pilot manifest dry-run/apply를 실행했다. 임시 backend에 Nginx를 연결한 상태에서 canonical backend를 교체하고 readiness 확인 후 원래 backend 포트로 복귀했다. 다른 서비스·validation demo는 재배포하지 않았다.
4. Nginx의 AI server block에 Console 경로만 추가하고 `nginx -t`/reload했다. Console host port는 `127.0.0.1:11003`, container listen은 `0.0.0.0:11003`이다. callback access log를 끄고 동적 페이지/API에 no-store를 적용했다. 기존 CloudFront의 cookie/query/header 전달과 최소 TTL 0을 확인했으며 distribution 설정은 변경하지 않았다.
5. 공개 readiness 200, Console 200/no-store, assets 200/no-cache, 비인증 session 401/no-store, login 302/no-store→운영 Works를 확인했다. 실제 Chrome OWNER 로그인→HJ Solution 홈→앱·사용량·감사→로그아웃→로그인 화면→재로그인을 통과했다. 실계정 화면 증거는 Git 제외 `work/console-production-owner.png`에 저장했다.

기존 전체 `npm run verify`: 서버 65 suites/511 tests, Web 37, demo 56 Pass. 격리 PostgreSQL Console access 11개 Pass(Works·Storage·embedding·Bedrock은 mock), 공유 Works fixture 7개와 pilot manifest 1개 Pass. 이 결과를 실제 AWS 지식 색인/답변 생성 시험으로 간주하지 않는다.

OWNER 검증 후 `npm run test:console-web` 37개 재실행 Pass, `RELEASE_TAG=20261014-console-01`과 `docker compose --project-directory . -f deploy/compose.production.yml -f deploy/compose.console.yml config --no-env-resolution --quiet` Pass. 수정 문서 상대 링크 검사·`git diff --check` Pass. build/typecheck/lint 전체 재실행은 문서/Compose 최종 확인에서 수행하지 않았으며 위 기존 후보 결과를 참조한다.

최종 공개 재조회는 `curl.exe`로 readiness/Console/asset/session/login 각각 200/200/200/401/302 및 위 cache 정책을 확인했다. Windows .NET HttpClient로 별도 조회했을 때는 5경로 모두 403이었으며 원인은 미확정이다. 실제 Chrome SSO와 curl 결과는 통과했으므로 이 별도 클라이언트 결과를 숨기거나 전체 접속 장애로 일반화하지 않는다.

| 실행 근거 | 결과 |
| --- | --- |
| SSM backup `1089f463-5d15-4b95-956c-6e77a00c5962` | dump/restore-list Pass |
| SSM corrected build `fe39a1b7-a853-458d-bece-671cdb11984f` | 위 이미지 build Pass |
| SSM rehearsal `75442360-e475-4908-ba16-c56bda43635b` | migration 26 / 앱 8 / 파일 23 / Console 테이블 5 Pass |
| SSM candidate/old image `70b5cfed-0e2e-43dd-9a21-97ca6f0ae414` | 신규·기존 API 호환 Pass |
| SSM promotion `8c0cd2a3-79ab-47c2-a41e-73accfd0a861` | 운영 migration·pilot·backend 전환 Pass |
| SSM Console listen correction `1ac76803-0ca6-4347-886e-d52b5c1795bf` | host Console 200, backend healthy |
| Chrome production OWNER | 실제 코드 교환·조직 표시·조회·로그아웃·재로그인 Pass |
| SSM final `afc5e0b9-8411-489a-b56c-e886a3c69714` | 운영 migration 26, 앱 8, 파일 23, 조직 1, membership 1, permission 10, ownership 0, active session 1; backend/Console/demo healthy, nginx Pass, rehearsal container 제거 |
| SSM 승인 ownership 적용 `598583ce-e5b1-45f7-ad05-770c92c70f30` | 정확한 8개 appcode 재검사, dry-run/apply apps 8 Pass, ownership 8·파일 23, AppInfo 전체 행 fingerprint 동일(키/설정 유지), 기존 세션 폐기 |
| Chrome ownership 후 재로그인 | 8개 앱, STORE_A 지식 5개/indexed·Key 메타데이터, 최근 30일 사용량 4건/3,056 tokens 및 로그 4건 조회 Pass; 신규 모델 호출을 실행한 결과는 아님 |

## 발견한 문제와 수정

- EC2 역할의 release S3 prefix 읽기가 403이었다. IAM을 확대하지 않고 비밀값 없는 artifact의 30분 presigned 다운로드를 사용했다.
- 첫 rehearsal에서 nonroot 이미지가 root-private migration 파일을 읽지 못했다. Prisma는 exit 0으로 “No migration found”를 출력했지만 migration 개수 검사로 중단했다. Dockerfile runtime COPY에 `--chown=nestjs:nodejs`를 적용해 재빌드 후 통과했다. 이 실패 시 운영 DB는 변경하지 않았다.
- 최초 공개 Console은 502였다. 기존 CLI의 container 내부 loopback listen이 원인이었다. Compose bootstrap의 listen을 `0.0.0.0`으로 바꾸고 최종 overlay의 명령 우선순위를 맞춰 Console만 재생성했다. backend는 healthy를 유지했다.

## 남은 작업과 복구 절차

- M5-05: 실제 브라우저 업로드→S3/embedding 색인→게시→Playground/지식 답변→보관·삭제 여정.
- 기존 앱 배정 완료: 사용자 승인 후 `external-crm`, `HJH`, `hj-ai-demo-store-a`, `hj-ai-demo-store-b`, `hj-ai-service-demo-store-a`, `hj-ai-service-demo-store-b`, `p4-deploy-e22b0d8eabaf`, `hj-zinframe-server`를 HJ Solution에 배정했다. 운영 manifest와 Git 제외 로컬 manifest를 동기화했다. 화면 증거는 `work/console-production-eight-apps.png`다.
- M6-01/03/05: UUID 비재사용·MFA·개인정보 정책, signed membership event 연계, staging 2개 조직·3개 역할과 장애/권한 철회 검증. 현재 Works 철회 반영은 승인된 최대 5분 절대 세션에 의존한다. Console DB 권한·상태는 요청마다 재검사한다.
- M6-04: OWNER 브라우저 통과, 다른 역할·조직 전환/거부 실제 계정 시험은 미실행.
- M7-03/04/05: secret rotation 운영 절차·관측 기준·scan·독립 검수·pilot 관찰/인수인계. 운영 pilot 한도는 null(무제한)이며 비용 한도 정책은 별도 확정해야 한다.

장애 시 먼저 AI Nginx block의 원본과 이전 이미지 Compose override를 이용해 backend를 복귀하고 Console 노출을 해제한다. 공유 Nginx 전체 파일을 무조건 덮어쓰지 않는다. additive schema를 유지한 이전 이미지 호환은 rehearsal로 확인했다. DB dump 복구는 쓰기 중단·복구 대상·이후 데이터 손실 범위를 확인한 별도 절차로 진행한다. 백업·rollback image·rehearsal DB는 유지하고, release 소유 rehearsal container는 검증 종료 후 제거한다.
