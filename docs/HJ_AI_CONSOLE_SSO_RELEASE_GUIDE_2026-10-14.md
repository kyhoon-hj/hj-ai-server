# AI Console SSO 배포 준비·pilot 등록

작성일: 2026-10-14 (KST). 아래는 배포 준비 절차다. 후속 실제 운영 pilot 배포·migration·OWNER SSO 검증은 [배포 기록](HJ_AI_CONSOLE_PILOT_DEPLOYMENT_2026-10-14.md)에 남겼다. 전체 공개 완료 기준은 남아 있다.

운영 Compose의 Console bootstrap은 container 내부 `0.0.0.0:11003`에서 listen하며 host port는 `127.0.0.1:11003`으로 제한한다. `server.mjs` 기본 CLI의 loopback listen을 container 포트 매핑에 그대로 사용하면 Nginx에서 502가 발생한다. 현재 `deploy/compose.console.yml`의 명령과 최종 overlay 우선순위를 유지한다.

## 준비 순서

1. [Works 작업 지시서](HJ_WORKS_CONSOLE_INTEGRATION_WORK_ORDER_2026-10-14.md)를 Works 작업에서 수행하고 실제 origin·client ID·secret 저장 위치·pilot UUID·역할·철회 정책을 인계한다.
2. M5-05의 실제 브라우저 지식 여정과 SSO staging 실계정 여정을 검증한다. 이번 격리 DB 시험은 저장소·embedding·모델·Works 교환 응답 mock을 사용한다.
3. 후보 전체 verify와 migration backup·rehearsal·rollback, 기존 AI API 유지, dependency/image scan을 완료한다.
4. 검증한 후보 revision과 pilot manifest·secret 설정을 확인한 후 운영 배포한다. 실제 공개 완료는 M7 완료 기준을 따른다.

## SSO 서버 설정

AI Server 운영 secret 설정에 다음 키를 넣는다. Console Web에는 client secret을 전달하지 않는다.

```dotenv
CONSOLE_WORKS_SSO_ENABLED=true
ENABLE_CONSOLE_DEV_IDENTITY=false
API_GLOBAL_PREFIX=
CONSOLE_PUBLIC_ORIGIN=https://ai.hjshub.com
WORKS_PUBLIC_ORIGIN=<Works 실제 HTTPS web origin>
WORKS_API_ORIGIN=<Works 실제 HTTPS API origin>
WORKS_CONSOLE_CLIENT_ID=<등록 client ID>
WORKS_CONSOLE_CLIENT_SECRET=<기존 secret 저장소에서 주입>
```

origin 값은 path·query·마지막 slash가 없는 정확한 HTTPS origin이다. 활성화 시 필수 값 누락, production HTTP origin, fixture 동시 사용, API prefix 설정은 시작을 거절한다. feature 비활성화 시 기존 fail-closed Console resolver를 유지한다.

## pilot manifest

Works에서 검증한 UUID와 승인 permission으로 manifest를 작성한다. 아래 `<...>`는 예시 placeholder이며 그대로 실행하면 검증에서 거절된다. manifest는 개인정보·조직 승인 자료이므로 소스에 실제 값으로 커밋하지 않는다.

```json
{
  "worksOrganizationId": "<검증된 회사 UUID>",
  "displayName": "Pilot Company",
  "members": [
    {
      "worksUserId": "<검증된 사용자 UUID>",
      "worksRole": "ADMIN",
      "permissions": ["apps:read", "apps:write", "credentials:read", "credentials:rotate", "credentials:revoke", "usage:read", "logs:read", "knowledge:read", "knowledge:write", "audit:read"]
    }
  ],
  "appInfoIds": ["<해당 회사 소유로 승인한 기존 AppInfo UUID>"]
}
```

지식 관리자는 `apps:read`, `knowledge:read`, `knowledge:write`, 조회자는 `apps:read`, `usage:read`, `logs:read`, `knowledge:read` 등을 명시적으로 승인한다. Works OWNER/ADMIN/MEMBER를 AI permission으로 자동 확대하지 않는다. 앱을 새로 생성할 pilot이면 appInfoIds는 빈 배열이다.

```powershell
node scripts/provision-console-pilot.mjs <manifest.json> --dry-run
node scripts/provision-console-pilot.mjs <manifest.json> --apply
```

기본은 dry-run이며 `--apply`에서만 단일 transaction으로 조직·identity·membership·앱 ownership을 등록한다. 알려지지 않은 permission, UUID 오류·중복, 존재하지 않는 앱·타 조직 앱, 비활성 identity·조직, 제거된 membership을 거절한다. 재적용 시 해당 membership 세션을 삭제하여 재인증시킨다. 역할·permission 변경은 manifest 승인 절차를 따른다. 기존 appcode·appkey는 변경하지 않는다.

## 배포 구성

신규 additive migration `20261014090000_add_console_sso_session`은 state hash와 session hash·membership FK·역할·만료를 저장한다. 원문 cookie와 Works client secret은 DB에 저장하지 않는다. 운영 DB 적용 전 backup/rehearsal을 수행한다.

Dockerfile은 Console Web과 pilot 도구를 이미지에 포함한다. `deploy/compose.console.yml`을 기존 production Compose의 **opt-in overlay**로 사용한다. 기본 Compose에는 Console 서비스를 자동 추가하지 않았다.

```text
docker compose --project-name hj-ai-server --project-directory . --env-file .env -f deploy/compose.production.yml -f deploy/compose.console.yml config --quiet
docker compose --project-name hj-ai-server --project-directory . --env-file .env -f deploy/compose.production.yml -f deploy/compose.console.yml up -d app console-web
```

위는 배포 시 사용할 명령 예시이며 이번 작업에서 실행하지 않았다. 두 Compose 파일과 `.env`의 실제 기준 경로는 기존 운영 릴리스 디렉터리 규칙을 확인한다. Docker Compose 출력에 secret이 포함될 수 있으므로 `config`는 `--quiet`로 검사한다.

저장소 root에서 실행할 때 `--project-directory .`를 지정해 `env_file: .env`와
`deploy/validation.env`를 release root 기준으로 해석한다.
2026-10-14 `docker compose --project-directory . -f deploy/compose.production.yml -f deploy/compose.console.yml config --no-env-resolution --quiet`는 임시 RELEASE_TAG로 **Pass**였다.
이 검사는 secret 값을 출력하거나 env 파일을 resolve하지 않는 Compose 구조 검사이며 이미지 빌드·컨테이너 시작·운영 적용은 아니다.

`deploy/console-proxy.conf.example`을 기존 AI HTTPS server block에 반영하여 `/console`, assets, Console API, Playground를 `127.0.0.1:11003`으로 보낸다. callback은 query access log를 끈다. 기존 `/v1`·knowledge·health 경로를 유지하고 `nginx -t` 후 반영한다. 파일 업로드 제한은 Web/BFF와 프록시에서 일치하도록 설정한다. 현재 예시는 30MB 업로드 기준이다.

## 현재 세션·철회 계약과 남은 제약

- state: 서버 랜덤 32bytes, 브라우저 HttpOnly cookie와 일치, 60초 DB 단일 사용.
- session: 랜덤 32bytes, HttpOnly·SameSite=Lax·production Secure cookie, hash만 DB 저장. 절대 5분 또는 Works expiresAt 중 빠른 시각에 만료, 자동 연장 없음.
- mutating Console API와 logout: 정확한 Console Origin 요구. BFF는 cookie·Origin을 전달하고 callback의 다중 Set-Cookie와 302를 보존한다.
- 로컬 identity·organization·membership 비활성, 역할 불일치는 다음 요청에서 거절하며 해당 세션을 삭제한다. permission은 매 요청 DB에서 조회한다.
- Works 정지·로그아웃·role 변경은 현재 교환 시에만 확인한다. 이미 발급된 세션에는 최대 5분 지연이 존재한다. event/introspection은 미구현이며 정책 승인 없이는 운영 완료로 판단하지 않는다.
- 다중 조직 선택은 Works에서 회사 선택 후 다시 로그인한다. 로그인 callback 성공은 해당 브라우저의 기존 Console session을 제거하고 새 회사 session으로 교체한다.
- 만료 state/session 정리는 다음 로그인에서 실행한다. 로그인 트래픽 rate limit과 보존 정책은 M7에서 운영 프록시·운영 환경 기준으로 확정한다.

## 운영 확인과 복구

Console 미로그인 API 401, Works 로그인/콜백, 실제 사용자·회사 표시, 역할별 쓰기/읽기, 타 조직 접근, logout 이후 401, 최대 5분 만료와 Works 장애를 검증한다. client secret·인가 코드·cookie는 로그와 검증 문서에 남기지 않는다.

문제 발생 시 Console proxy 경로를 차단하고 `CONSOLE_WORKS_SSO_ENABLED=false`로 비활성화한 뒤 검증된 이전 이미지로 복구한다. Console Web만 내리고 기존 AI API 경로를 유지한다. additive session table은 이미지 rollback과 별개로 남겨두며 운영 DB를 임의로 삭제·복원하지 않는다. 이미 노출된 secret이 있다면 Works에서 credential을 회전하고 양쪽 실계정 시험을 다시 수행한다.
