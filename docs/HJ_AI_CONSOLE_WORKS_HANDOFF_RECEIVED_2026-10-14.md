# Works 연계 인계 수신 및 운영 접속 확인

날짜: 2026-10-14 (KST)

사용자가 Works 작업 완료를 알렸다. `AI RAG 연계 서비스 연결` 작업의 완료 기록과
`C:\Work\HJSolution\hj-works\hj-works-v1-main\docs\hj-ai-console-integration-handoff-2026-10-14.md`를 읽어 확인했다.
Works 소스·설정은 수정하지 않았다.

## 확인된 인계

| 항목 | 확인 내용 |
| --- | --- |
| 환경 | 운영 `https://works.hjshub.com` |
| 서비스 | `HJ_AI_CONSOLE` / HJ AI Console 등록 완료 |
| client ID | `svc_3-YzsmiuPtvP3jQDmh-B5ymRkeXDu1wdNHJMBiV8Ym0` |
| callback | `https://ai.hjshub.com/console/auth/callback` |
| 시작 주소 | `https://ai.hjshub.com/console/auth/login` |
| pilot 회사 | HJ Solution, `fcb6aea9-2b79-4bd7-8928-cdb3d0dcee7d`, ACTIVE 배정 완료 |
| 세션 정책 | 최대 5분 절대 세션·철회 지연 승인, 자동 연장 없음 |
| 권한 소유 | Console이 세부 permission을 관리하며 Works 역할로 자동 승격하지 않음 |

Works 등록·회사 배정은 Works 완료 기록에 근거하며 AI Server에서 재등록하지 않았다.
Works UI 로그인 시작 버튼 변경은 아직 Works 운영에 배포하지 않았다고 인계서에 명시되어 있다.
기존 base URL을 통한 Console 진입은 AI Server 배포 후 검증할 수 있다.

## 실제 공개 경로 확인

Node fetch, GET, redirect manual, timeout 10초로 확인했다. 로그인·코드 발급·credential 변경은 실행하지 않았다.

| 주소 | HTTP 결과 |
| --- | --- |
| `https://ai.hjshub.com/console` | 404 |
| `https://ai.hjshub.com/console/auth/login` | 404 |
| `https://ai.hjshub.com/health/ready` | 200 |
| `https://works.hjshub.com/api/v1/auth/service-code/exchange` GET | 404 |

코드 교환은 POST 계약이므로 GET 404로 POST endpoint 부재를 판단하지 않는다.
현재 실제 Works API origin과 교환 응답·운영 revision은 공동 검증 전이다.
Console 404는 운영 접속 완료로 선언할 수 없다는 직접 근거다.

## 공유 계약 검증

Works의 합성 fixture `docs/fixtures/hj-ai-console-sso-v1.json`을 이 저장소의
`src/console/contracts/fixtures/hj-works-console-handoff-2026-10-14.json`으로 수신했다.
실제 회사·사용자 데이터가 아니며 고정 검증 시각으로 응답 구조와 만료를 검사한다.
`supportsSystemManagerAccess`는 요청에서 생략하고 추가 `accessContext`는 strict parser에서 거절한다.
직원 membership 없는 플랫폼 관리자는 pilot 사용자로 대체하지 않는다.

검증: `npm run test:ci -- --testPathPatterns=hj-works-identity.contract` — **Pass, 1 suite/7 tests**.
이는 공유 합성 fixture의 소비 계약·만료·추가 권한 필드 거절 검사이며 운영 SSO 성공을 의미하지 않는다.

## 아직 필요한 정보와 다음 작업

- client secret은 Works에서 발급됐으나 AI Server 운영 secret 저장소 전달이 필요하다. 원문은 문서·채팅에 기록하지 않는다.
- 최초 pilot 관리자: 사용자가 지정한 이메일 계정을 운영 Works 직원 목록에서 확인했다. HJ Solution의 ACTIVE/OWNER 멤버십이며 사용자 UUID `0cb93e57-4c5b-42af-8664-f82ee5a92642`다. 전화번호는 연계 자료에 저장하지 않았다.
- 사용자 지정 회사 대표 관리자 범위로 앱·credential·사용량·로그·지식·감사의 현재 구현 permission 10개를 pilot manifest `work/console-pilot-hj-solution.json`에 준비했다. Git 제외 파일이며 운영 적용은 아직 하지 않았다. 미구현 멤버·결제 관리 권한은 추가하지 않았다.
- 기존 AppInfo의 회사 ownership 매핑과 두 조직·세 역할 실계정 시험은 미완료다.
- UUID 비재사용·MFA·개인정보 정책 및 운영 SSO revision/응답 확인도 남아 있다.
- AI Server 로컬 `.env`에는 SSO 활성화·origin·client ID·client secret 키가 없다. 운영 secret 설정 상태는 이 사실로 추정하지 않는다.

운영 UI와 정상적으로 관측된 `/api/v1/admin/tenant/members` 응답에서 지정 계정 UUID·OWNER·ACTIVE를 확인했다. API origin은 실제 UI 호출의 `https://works.hjshub.com`을 사용한다.
기존 보안키의 '보기'를 눌렀으나 최근 로그인 인증 만료로 조회가 거절됐다. credential 재발급/회전/서비스 수정은 실행하지 않았다. 비밀키는 확보·저장되지 않았으며 사용자에게 운영 재로그인을 요청했다.
증빙: Git 제외 `work/console-works-reauth.png` (키 마스킹).

후속: 사용자가 재로그인했으나 회사 OWNER 계정으로 로그인하여 시스템 서비스 관리 화면에서
`시스템 관리자만 시스템 관리 메뉴를 사용할 수 있습니다`로 조회가 거절됐다.
사용자는 Works 시스템 관리자 계정으로 재로그인하는 전달 방법을 선택했다. 완료 알림 대기 중이다.
Git 제외 `work/console-sso.production.env`에 공개 origin/client ID와 빈 secret 항목을 준비했다.
secret은 아직 확보되지 않았으며 설정 파일만으로 SSO 활성화 완료를 뜻하지 않는다.

운영 점검용 AWS CLI는 `Your session has expired`로 거절됐다. AWS CLI 2.35.8 확인 후
사용자의 명시적 실행 승인을 받아 `aws login --no-cli-pager`를 실행했다.
브라우저는 패스키/MFA 추가 인증에서 취소 메시지를 표시하며 사용자 인증 완료를 기다리고 있다.
SSM/운영 DB 조회·변경·배포는 아직 실행하지 않았다. 증빙은 Git 제외 `work/console-aws-mfa.png`다.

후속: 사용자의 AWS 인증 완료 알림 후 STS·EC2/SSM·실제 AI DB migration·proxy·CloudFront 읽기 점검을 완료했다.
AWS 인증 차단은 해소됐으며 운영 DB는 17/26 migrations, Console 테이블 없음이다.
[운영 사전 점검](HJ_AI_CONSOLE_PRODUCTION_PREFLIGHT_2026-10-14.md)에 결과와 command ID를 기록했다.
보안키 전달·운영 migration·배포는 여전히 미실행이다.

pilot 검증: 로컬 PostgreSQL만 허용하는 hostname 확인 후
`node scripts/provision-console-pilot.mjs work/console-pilot-hj-solution.json --dry-run` — **Pass**, members 1/apps 0.
manifest와 증빙의 `git check-ignore` — **Pass**. DB write·운영 적용은 하지 않았다.
기존 AppInfo ownership 매핑 승인이 없어 앱 자동 귀속은 하지 않았다.

최종 후보 재검증: `npm run verify` — **Pass**, build/typecheck/lint,
65 suites/511 server tests, 37 Web tests, 56 demo tests.
Compose overlay는 `--project-directory .`, `config --no-env-resolution --quiet`로 **Pass**.
production env 값을 resolve하지 않는 구조 검사이며 이미지 빌드·운영 시작 검증은 아니다.

서비스 등록·회사 배정·5분 정책 승인과 최초 pilot 사용자 식별 차단은 해소됐다. M6 전체 완료는 아직 아니며,
남은 차단은 Works 최근 로그인 재인증·secret 전달·운영 적용·실계정 검증이다.
이 정보 확보 후 승인 manifest dry-run·적용, 후보 검증·운영 배포, 실제 SSO·RAG 검증을 이어간다.

후속 진행: Works 시스템 관리자 최근 로그인 확인 후 기존 보안키 조회·Git 제외
`work/console-sso.production.env` 전달을 완료했다. 원문을 출력하지 않았고 화면에서 다시 숨겼다.
SecureString `/hj-ai-server/console/works-client-secret/20261014-console-01`로 운영 전달을 준비했다.
EC2 역할의 decryption 접근은 Version만 출력하는 명령으로 확인했다. 신규 credential 발급·rotation은 하지 않았다.
20261014-console-01 후보 이미지 빌드와 실제 DB backup 완료 후 복원 DB migration rehearsal을 준비 중이다.

후속 운영 검증: release `20261014-console-01`의 복원 DB rehearsal·이전 이미지 호환을 통과하고 운영 migration 17→26, backend·Console 배포와 SecureString 기반 설정 적용을 완료했다. 실제 지정 OWNER 계정으로 HJ Solution 표시·홈/앱/사용량/감사 조회·logout/relogin을 확인했다. M6-02와 M7-02는 완료, M6/M7은 각각 검증 중 1/5다. 위의 최근 인증·secret·배포·OWNER 로그인 차단은 해소됐다. 실제 AWS 지식·다중 조직/역할·공동 정책과 기존 앱 ownership은 잔여다. [운영 pilot 배포 기록](HJ_AI_CONSOLE_PILOT_DEPLOYMENT_2026-10-14.md) 참조.

이후 사용자 승인으로 기존 8개 앱 모두 HJ Solution ownership 등록을 완료했다. 기존 AppInfo 키/설정과 지식 파일 23개를 보존하고 재로그인 후 8개 앱·지식/Key 메타데이터·사용량/요청 로그 조회에 성공했다. ownership 확인 차단도 해소됐으며 실제 AWS 업로드/답변·다중 조직/역할·공동 정책 검증은 남아 있다.
