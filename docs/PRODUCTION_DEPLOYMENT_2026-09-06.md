# AI 서버·검증 데모·서비스 데모 운영 배포

2026-09-06 KST. AI 서버 및 검증 데모의 EC2 배포와 서비스 데모 Sites 배포 완료. 공개 HTTPS 경로에서 실제 AWS 호출 검증 완료.

## 접속 및 배치

| 서비스 | 외부 주소 | 실행 위치 | 포트 |
|---|---|---|---|
| AI Server | https://ai.hjshub.com | EC2 `works-server`, Docker `hj-ai-server-app-1` | `127.0.0.1:11000` → 컨테이너 11000 |
| 검증 데모 | https://ai.hjshub.com/validation/ | 같은 EC2, Docker `hj-ai-server-validation-demo-1` | `127.0.0.1:11001` → 컨테이너 11001 |
| 서비스 데모 | https://hj-mart-assist.kyhoon-hj.chatgpt.site | Sites / Cloudflare Workers, 소유자 전용 | 외부 HTTPS 443; 로컬 개발만 11002 |

외부 경로는 CloudFront → EC2 Nginx 80 → AI/검증 컨테이너다. 검증 데모 전체 경로에 Nginx Basic 인증과 `Cache-Control: no-store`를 적용했다. 로그인 사용자명은 `hj-validation`; 비밀번호는 문서나 Git에 기록하지 않는다. 배포 작업자의 로컬 `work/deployment/validation-login.txt`와 운영 릴리스의 `validation-login.json`에서 확인한다.

서비스 데모의 소유자 계정 `kyhoon.hj@gmail.com`을 관리자·상담원 이메일 허용 목록에 설정했다. 플랫폼 로그인과 서버 권한 판정을 사용하며 로컬 우회 세션 토큰은 운영에 주입하지 않았다.

## 운영 관리 위치

- EC2: `i-0c6431bf77d888faf`, 서울 `ap-northeast-2`, SSM Online.
- 현재 릴리스: `/home/ubuntu/hj-ai-releases/20260906-01`.
- Compose: 현재 릴리스의 `deploy/compose.production.yml`, 프로젝트 이름 `hj-ai-server`.
- 이미지: `hj-ai-server:20260906-01`, `hj-ai-validation:20260906-01`.
- 기존 소스 `/home/ubuntu/hj-ai-server`는 그대로 보존했다. 이 경로의 구 Compose를 실행하면 이전 구성으로 돌아갈 수 있으므로 현재 운영 관리에는 릴리스 경로를 사용한다.
- 검증 리포트: Docker volume `hj-ai-server_validation-reports`, 컨테이너 `/app/demo/reports`.
- Nginx: `/etc/nginx/sites-available/default`; AI 서버 블록에 `/validation/` 경로만 추가했다.
- 백업: `/home/ubuntu/hj-ai-backups/20260906-01` — `hj-ai.dump`, 원래 Compose·환경설정·컨테이너 정보·Nginx 설정 보존.
- 이전 이미지 보존 태그: `hj-ai-server:rollback-20260906-01`.

운영 상태 확인 예시:

```sh
cd /home/ubuntu/hj-ai-releases/20260906-01
RELEASE_TAG=20260906-01 docker compose --project-name hj-ai-server --project-directory . -f deploy/compose.production.yml ps
```

현재 앱이 비정상일 때는 우선 로그와 readiness를 확인한다. 이전 앱 이미지로 복구하더라도 DB schema를 자동으로 되돌리지 않는다. DB 복원은 쓰기 중지, 백업 시점 이후 데이터 영향 검토 후 별도로 수행한다. 이번에는 `pg_dump` 성공 및 `pg_restore --list` 읽기만 확인했으며 전체 DB 복원 리허설은 수행하지 않았다.

## 데이터 및 버전

- 운영 DB: RDS PostgreSQL **18.3**, `hj-ai`, 포트 **5432**. 과거 로컬 PostgreSQL 16 기록과 구분한다.
- migration: 기존 8개 → 13개 적용. 사전 검사에서 중복 appcode 0, 기존 앱 2개, 기존 지식 파일·청크 0 확인.
- 기존 앱 2개를 보존하고 검증용 `hj-ai-demo-store-a/b`, 서비스용 `hj-ai-service-demo-store-a/b`를 별도로 구성했다.
- 검증 환경 재설정의 키 회전·정리 작업이 서비스 데모 앱에 영향을 주지 않도록 분리했다. 검증 데모의 메모리상 프로필은 재시작 시 초기화되므로 필요하면 검증 환경 구성을 다시 실행한다.
- AI source SHA256: `eeba9879eab6718d3409e12079f2df303882d93c89b4deb3cb1f55f33905ace1` — 로컬 검증 빌드와 운영 이미지의 fingerprint 일치.
- AI 소스 기준 Git HEAD: `9dfdbd04282d7d51a4d40f071fbd0079b1060595` + 미커밋 작업 트리. Git HEAD만으로 배포 상태를 식별할 수 없으므로 fingerprint와 릴리스를 함께 사용한다.
- Sites: 버전 4, 소스 `73501f24fa36ec7da3640559884fc65795cbf421`, 환경 revision 1, deployment `appgdep_6a9cbbd2c21881919dfdb121d639075d` succeeded.

## 이번에 수정한 배포 문제

1. 검증 데모의 정적 파일·API·다운로드 URL을 현재 배치 경로 기준으로 계산해 `/validation/` 하위 호스팅 지원.
2. 배포 smoke 도구가 검증 URL의 하위 경로를 버리던 문제 수정.
3. Sites 서버 fetch에 User-Agent가 없어 WAF `AWSManagedRulesCommonRuleSet / NoUserAgent_HEADER`에 차단되는 것을 실제 sampled request에서 확인. health·답변·지식 관리 요청에 `HJ-Service-Demo/1.0`을 추가. 공유 CloudFront/WAF 규칙 변경 없음.

## 검증 결과

- 서버 build/typecheck/lint PASS, 서버 단위 210개 PASS.
- 검증 데모 51개, 서비스 데모 56개 PASS; 서비스 빌드 PASS.
- AI 후보를 임시 loopback 11003에서 검사한 후 제거하고 11000으로 전환.
- 공개 AI live/readiness 200, 무인증 관리자/잘못된 appkey 거절, Swagger 비노출 확인.
- 검증 페이지·JS·CSS·성능 모듈·catalog 인증 접속 200, 무인증 API 401.
- Sites → 공개 AI → 실제 Bedrock: STORE_A 7일 / STORE_B 14일 정책을 각 매장 문서 출처와 함께 응답. 자료 없는 재입고 질문은 `answerable=false`.
- 실제 S3 업로드 → 공개 정책 → job 제출 202 → 인덱싱 completed → 타 매장 파일 접근 404 → 보관·객체 삭제 요청 200 → 활성 목록 제외 확인.
- API 검사 및 답변 계약 15개, 파일 생명주기 검사 11개 PASS. 작업 리포트: `work/deployment/live-check.json`, `work/deployment/lifecycle-check.json`.

Sites 검사는 기존 플랫폼의 identity-less API 테스트 토큰을 사용했다. 관리자 identity가 없는 경우 403을 확인했으며, 실제 소유자 브라우저 로그인·관리자 화면 클릭 검수는 이번 자동 검사에 포함하지 않았다. 운영 장기 부하·독립 품질 검수·상담원 검토함 영구 저장은 별도 작업이다.
