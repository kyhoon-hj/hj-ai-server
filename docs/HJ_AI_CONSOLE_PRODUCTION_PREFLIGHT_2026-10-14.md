# AI Console 운영 사전 점검

점검일: 2026-10-14 (KST). 실제 AWS/운영 DB 읽기 결과이며 운영 변경·배포는 미실행이다.

## AWS 인증과 대상

사용자가 승인한 `aws login`과 패스키/MFA 완료 후 `aws sts get-caller-identity` 성공.
계정 `608311474994`, principal `arn:aws:iam::608311474994:user/codex/codex-operator`가 기존 AI 운영 대상과 일치한다.
EC2 `i-0c6431bf77d888faf` / 서울 `ap-northeast-2` / `works-server` / `t3a.medium`은 running,
SSM Online, Ubuntu 26.04다. AWS 인증 차단은 해소됐다.

## 현재 AI Server와 DB

SSM AWS-RunShellScript를 해당 instance 하나에 실행하여 `hj-ai-*` 컨테이너와 AI DB migration·Console 테이블 목록,
AI nginx server block을 읽었다. 환경변수·연결 문자열·credential 값은 출력하지 않았다.
다른 서비스 소스·DB는 읽거나 수정하지 않았다.

| 항목 | 결과 |
| --- | --- |
| AI 앱 | `hj-ai-server-app-1`, healthy |
| image | `sha256:dc79f7d2a06e38c8dc9ebd5765bcebd72df94194509d3fb2b280747b3287c8d5` |
| 릴리스 | `/home/ubuntu/hj-ai-releases/20260911-family-ai` |
| Compose | 해당 릴리스의 `deploy/compose.production.yml`, `deploy/family-ai-image.json`, `/opt/works-server-management/compose-overrides/hj-ai-server-1/health.override.json` |
| 검증 데모 | `hj-ai-server-validation-demo-1`, healthy, 별도 `20260907-03` directory |
| 내부 readiness | `http://127.0.0.1:11000/health/ready` → 200 |
| 디스크 | root 48G, used 37G, available 12G |
| migrations | 17개 finished, 마지막 `20260911010000_add_family_embedding_usage` |
| Console 테이블 | organization/identity/membership/session/auth_state 모두 없음 |
| SSO flag / Works secret | false / 앱 환경에 없음 (값 조회하지 않음) |

현재 작업본은 26개 migrations다. 운영 반영 전 **미적용 9개**의 백업·격리 리허설·기존 API 호환 검증이 필요하다.
이번 점검은 migration 상태를 읽었으며 적용하지 않았다.

## AI 프록시와 CloudFront

`/etc/nginx/sites-available/default`의 `server_name ai.hjshub.com` 블록만 확인했다.
80번 listener, `/validation`·`/validation/` → 11001, 기본 `/` → 11000이며 Console 전용 location은 없다.
기존 Host·X-Forwarded-*·WebSocket 설정을 보존해 해당 블록에 Console 경로만 추가해야 한다.

CloudFront `EWL2WT7KZR60R`은 ai.hjshub.com을 포함한 여러 서비스가 공유한다. 설정 조회만 했으며 변경하지 않았다.

- 기본 cache policy `83da9c7e-98b4-4e11-a168-04f0df8e2c65` / UseOriginCacheControlHeaders: MinTTL·DefaultTTL 0, cookies all, cache-key header에 host/origin 포함.
- origin request policy `216adef6-5c7f-47e4-b989-5492eafa07d3` / Managed-AllViewer: headers/cookies/query 모두 전달.
- 기본 behavior는 GET/HEAD/OPTIONS/PUT/POST/PATCH/DELETE 허용. Console 경로는 기본 behavior 대상.
- `/api/*`, `/ws/*` 별도 behavior 존재. 다른 도메인이나 global 정책 변경은 이번 범위에 포함하지 않는다.

설정상 cookie·state/code query·Origin 전달이 가능하다. 배포 후 Console 문서/API/auth의
`Cache-Control: no-store`, 실제 콜백·세션 동작을 공개 경로에서 확인해야 한다.
설정 조회를 SSO 운영 성공 증거로 대신하지 않는다.

## 검증 근거

| 명령·동작 | 결과 |
| --- | --- |
| STS/EC2/SSM 조회 | Pass, 계정 일치·running/Online |
| SSM 기본 점검 | Success, command `c046e9eb-bdfb-47c0-b5cd-12d4b1c51bf9` |
| SSM DB·proxy 점검 | Success, command `b51a053f-5601-452d-ab3b-0da78b454766` |
| CloudFront distribution/cache/origin-request policy 조회 | Pass, 읽기 전용 |
| 로컬 credential readiness | false, Git 제외 파일의 secret은 여전히 비어 있음 |

로컬 후보 품질·pilot dry-run은 [Works 인계 수신 기록](HJ_AI_CONSOLE_WORKS_HANDOFF_RECEIVED_2026-10-14.md)을 따른다.
운영 앱·nginx·CloudFront·DB·credential은 변경하지 않았다.

## 다음 작업

Works 시스템 관리자 최근 로그인 → 기존 보안키 전달 → 실제 Compose/env 기반 DB backup·9개 migration rehearsal·rollback 준비
→ OWNER pilot 운영 dry-run → 후보 배포·AI nginx 경로 → 실제 Works SSO/권한/logout·RAG 검증 순으로 진행한다.
기존 AppInfo는 승인 ownership 매핑 없이 자동 귀속하지 않는다.
M5 실제 브라우저/AWS 검증과 M6 실계정·정책 완료 기준은 여전히 남아 있다.

## 후속 결과 — 사전 점검 이후

기존 보안키 전달과 운영 backup·복원 DB rehearsal·이전 이미지 호환 검증 후 release `20261014-console-01`을 운영에 적용했다. migration은 26개, 기존 앱 8·파일 23을 유지하며 backend·Console·기존 demo 모두 healthy다. Console 200, 비인증 session 401, login 302, 실제 HJ Solution OWNER SSO·조회·logout/relogin Pass다. 이 결과는 위의 읽기 전용 사전 점검 당시 결과와 구분한다. [운영 pilot 배포 기록](HJ_AI_CONSOLE_PILOT_DEPLOYMENT_2026-10-14.md)에 이미지·backup·SSM 명령·한계를 기록했다. 기존 앱 ownership은 아직 0개다.

후속 사용자 승인으로 ownership 8개를 HJ Solution에 등록했다. 적용 전후 AppInfo 전체 행이 동일하며 파일 23개를 유지했다. 실제 Console의 8개 앱·기존 지식·Key 메타데이터·사용량/로그 조회를 확인했다.
