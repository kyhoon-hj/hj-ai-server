# 월 요청·토큰 한도 운영 배포 및 실검증

검증일: 2026-10-22 (KST). 사용자 요청에 따라 HJ_AI_Server의 운영 migration, 서버·Console 배포와 실제 한도 검증을 수행했다.

**[Console M7 | 운영 준비·pilot·공개 | 검증 중 | 1/5]** — 이번 한도 배포는 완료했다. 전체 M7 공개 기준은 별도 잔여다.

## 배포 및 복구 근거

- 대상: `ap-northeast-2`, EC2 `i-0c6431bf77d888faf`, `https://ai.hjshub.com`.
- 기존 운영 DB를 dump하고 별도 DB에 복원하여 migration 26→27과 후보 서버 readiness 200을 확인한 뒤 운영에 `20261022090000_add_app_request_limit`을 적용했다.
- 릴리스: `/home/ubuntu/hj-ai-releases/20261022-quota-01`, 배포 설정 `compose-deploy.json`. 기존의 실제 보안·네트워크·Swagger 설정을 보존했다.
- 서버: `hj-ai-server:20261022-quota-01`, image SHA-256 `60b9e0bdbd676e258baf7303e534142a3f1eeab22f33644066c7eb06bfa0f947`.
- Console: `hj-ai-server:20261022-quota-console-02`, image SHA-256 `6e02d415cab80d6cafadffb0e4a64edba9215e1fda3a3c30779352fc1be756bf`.
- 초기 런타임 압축본 SHA-256: `8fb624dc3f27a9a56482dc0cae2a5c54cbc6e5018c31173efde30facbea98563`. Console에는 아래 저장 이벤트 수정이 추가됐다. 배포는 미커밋 작업본을 기반으로 하며 커밋 식별자 대신 이미지 digest로 식별한다.
- 비공개 백업: `/home/ubuntu/hj-ai-backups/20261022-quota-01`의 `database.dump`, `restore-list.txt`, 기존 컨테이너·환경·Compose 설정. dump 375233 bytes, SHA-256 `b369e5b58eb6ed80e57fe05ae639614889c4be30ba9dcd64ba2f97ada9816608`.
- 이전 이미지 태그 `hj-ai-server:rollback-20261022-quota-01` 보존. 이미지 복구 명령은 `docker compose --project-name hj-ai-server -f /home/ubuntu/hj-ai-backups/20261022-quota-01/compose-before.json up -d --no-deps --wait --wait-timeout 120 app console-web`이다. 이번 배포에서 rollback은 실행하지 않았다. 추가 nullable 컬럼은 유지하며 운영 DB 역복원은 별도 판단 대상이다.

## 발견한 문제와 수정

실제 브라우저 저장 후 DB 조회에서 한도가 null로 남아 있는 문제를 발견했다. `console-web/public/app.js`에서 한도 payload가 앱 저장 대신 요청 로그 필터 이벤트에 들어가 있었다. 해당 두 필드를 실제 앱 저장 이벤트로 이동했다. `console-web/tests/quota-settings.test.mjs`에 실제 submit handler를 실행해 전송 payload와 필터 비오염을 확인하는 회귀 테스트를 추가했다.

`npm run test:console-web` **40/40 Pass** 후 Console 수정 이미지를 배포했다. 서버 622개·격리 DB 27개·build/typecheck/대상 lint Pass는 앞선 구현 검증 기록이며 이 배포 중 재실행한 결과로 표시하지 않는다.

초기 promotion 명령은 컨테이너 전환에 성공했으나 뒤의 정적 파일 검사 URL이 잘못되어 exit 1이었다. 실제 경로 `/console-assets/app.js`로 재검증해 200과 한도 코드 반영을 확인했다. 배포 실패 또는 rollback으로 해석하지 않는다.

## 운영 실검증

실제 Chrome에서 Works OWNER SSO로 로그인하고 Console 앱 개요에서 한도를 저장했다. 검증 앱은 `3932aa31-2594-4439-9bb5-057e7e981cd1` (월 한도 배포 검증 20261022)이다. 공용 HTTPS `POST /knowledge/answers`로 가상의 안내 질문과 테스트 보충 자료를 전송했다. AWS embedding 및 Bedrock 생성은 실제 호출이며 mock이 아니다.

| Console 설정 (월 요청 / 월 토큰) | 결과 | 실측 |
| --- | --- | --- |
| 1 / 10000, 첫 요청 | 200, 답변 생성 | 입력 1400 + 출력 61 = 1461, AWS operations 2 |
| 1 / 10000, 두 번째 요청 | 429 `APP_MONTHLY_REQUEST_LIMIT_EXCEEDED` | AWS operations 0, 사용량 증가 없음 |
| 무제한 / 0 | 429 `APP_MONTHLY_TOKEN_LIMIT_EXCEEDED` | AWS operations 0, 사용량 증가 없음 |
| 무제한 / 1461 (누적 사용량과 동일) | 429 `APP_MONTHLY_TOKEN_LIMIT_EXCEEDED` | AWS operations 0, 사용량 증가 없음 |
| 5 / 10000으로 상향 | 200, 생성 재개 | 추가 1461, 누적 2회 / 2922 토큰 |
| 검증 종료: 비활성, 0 / 0 | 403 | 기존 검증 credential로 생성 불가 |

생성 재개 후 실제 Console 사용량 화면에서 요청 사용 2·예약 0·한도 5·잔여 3, 토큰 사용 2922·예약 0·한도 10000·잔여 7078을 확인했다. 최종 DB의 예약 두 건은 모두 SETTLED다. 검증 키 원문 임시 파일을 삭제했고 앱은 비활성으로 남겨 검증 기록을 보존했다.

요청 추적 ID(위 표 순서): `54b03c56-cdee-43f2-99ea-86722d196e47`, `6b82f399-0e9d-4e1c-9fb9-cf513d2e506b`, `b170e355-4643-48a2-8d85-4c551009b07d`, `d4c9f8c2-0ae9-4c25-bf33-3fd255aa91ef`, `a5ee5d7e-73a6-47f6-a9ea-8b41c19f064e`.

## 최종 상태 및 범위

- 기존 9개 앱의 상태·토큰 한도·현재/이전 키 hash를 백업 복원 DB와 대조하여 동일함을 확인했다. 기존 앱의 신규 요청 한도는 모두 null이다. 사용자가 지정하지 않은 서비스에 임의 제한을 설정하지 않았다.
- migration 27개, 앱 10개(검증 앱 1개 포함), 지식 파일 23개. 임시 rehearsal DB는 제거했고 백업은 유지했다.
- 공용 `/health/ready`, `/console`, `/console-assets/app.js` 모두 200. 서버·Console 두 컨테이너 모두 healthy.
- UTC 월간 기준이며 생성 입력·출력 토큰 합계에 적용한다. Jev/embedding 토큰은 한도 합계에서 제외된다. 진행 중 생성 중단이나 모든 생성 경로의 운영 실호출을 검증한 것은 아니다. 실제 업로드·색인 전체 여정, 다중 조직/역할, 전체 M7 관측·검수는 잔여다.

## 커밋 전 최신 변경 대조 — 2026-10-22

`npm run build` 재실행 Pass. 재빌드한 런타임 427개 파일(빌드 캐시 `.tsbuildinfo` 제외)이 배포 manifest와 SHA-256 기준 모두 일치했다. 운영 Console 컨테이너(서버 이미지 상속)의 dist 및 최종 app.js 총 430개 파일도 로컬 배포본과 모두 일치했다. SSM `af3b6b68-4b82-453b-944f-19203de63ecd` Success. 따라서 Jev 선분류·파싱 보완·REQ-01/02 분류 요약/로그 계약과 Console 최신 서버 코드는 배포 이미지에 포함됐다.

단, 운영 서버 환경에서 `JEV_AI_RAG_MODE`는 미설정(코드 기본값 off), `JEV_AI_RAG_APPCODES`도 미설정이다. Jev 선분류 기능은 활성화되지 않았으며 고객문의 전용 인스턴스·앱/키·허용 앱 설정(SET-01), 지식/모델 정책(SET-02), 대표 문의 실연동(VAL-01)은 완료로 표시하지 않는다. 이번 확인에서 운영 설정을 변경하지 않았다. 월 한도와 AWS 답변 생성의 실검증 결과는 위 기록대로 유효하다.

주요 SSM 근거: backup `3061ebb5-d0b1-4876-a0bb-d97fbf2d5492`, 후보 `4c0548bb-0150-4e8c-bd1e-ab8cf9397604`, promotion `48230d16-3d9d-48a8-9cbc-1be966562b32`, Console 수정 `bc1b57d1-242b-431d-89e1-de5ff85e09b4`, 요청 한도 `e16b18a2-a170-49b2-956a-c73e4a9918ab`, 토큰 경계 `066a8063-034d-4639-a8a7-e21f84dd612d`, 재허용 `70af2968-7d6e-4086-ad0e-697d7839a652`, 최종 보존·정리·health `039936b9-6a00-4a43-a3c1-520c4d9a9832` (Success).
