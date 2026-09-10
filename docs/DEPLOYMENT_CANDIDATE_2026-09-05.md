# AI 서버·검증 데모·서비스 데모 배포 준비

> 후속: 2026-09-06 세 서비스 운영 배포 및 실제 API 검증 완료. 현재 운영 경로와 결과는 [운영 배포 기록](PRODUCTION_DEPLOYMENT_2026-09-06.md)을 참조한다. 아래 내용은 배포 전 기록이다.

상태: 후보 구성 준비. 운영 배포 미실행. 운영 호스트와 SSM 접속은 후속 [AWS 실측](AWS_PRODUCTION_DISCOVERY_2026-09-05.md)에서 확인됨. 검증 데모 주소 확인 필요. 아래 초기 조사 내용은 당시 상태를 기록한다.

## 확인된 상태

- 운영 AI 주소 `https://ai.hjshub.com`: live/readiness 모두 HTTP 404. 최신 API 배포 여부를 확인할 수 없으며 현재 준비 완료로 판정하지 않음.
- 기존 서비스 데모 `https://hj-mart-assist.kyhoon-hj.chatgpt.site`: Sites에 등록되어 있고 현재 소유자만 접근 가능. 런타임 환경변수 0개.
- AI 서버 빌드 PASS. 서비스 데모 빌드 및 테스트 56개 PASS.
- 검증 데모 Compose 설정 검사 PASS. 로컬 Docker 엔진이 실행되지 않아 컨테이너 이미지 빌드는 아직 미검증.
- 원격 SSH/deployment host 설정은 저장소와 로컬 SSH config에서 확인되지 않음.

## 준비한 구성

- `deploy/validation.Dockerfile`: Node 24, 비 root, 검증 데모 11001.
- `deploy/compose.validation.yml`: 기존 AI 서버와 검증 데모 연결. 두 origin 포트를 loopback에만 바인딩, 검증 리포트는 named volume에 저장.
- `deploy/validation.env.example`: 검증 전용 런타임 키 템플릿. 실제 deploy/*.env는 Git 제외.
- `deploy/validation-proxy.conf.example`: 검증 콘솔 전체 경로에 HTTPS reverse proxy 내부 인증 적용용 location 예시. 도메인·TLS·사용자 암호 파일은 운영 호스트에서 별도 설정.
- `scripts/deployment-smoke.mjs`: 응답 본문·credential을 출력하지 않는 읽기 전용 live/readiness 및 검증 콘솔 인증 게이트 확인.

검증 콘솔은 관리자 설정 및 테스트 실행 기능을 제공하므로 인증 없는 공개 URL로 배포하지 않는다. API origin을 loopback으로 바꾸기 전에 기존 Nginx가 호스트에서 이 포트로 연결되는지 확인해야 한다. 컨테이너 프록시인 경우 동일 네트워크의 서비스 이름으로 연결한다.

## 운영 호스트 확인 후 실행 순서

1. 호스트·기존 Compose/프록시·DB·AWS 인증 방식과 실행 중 워커 확인. 현재 이미지·설정 및 DB 백업을 보존하고 migration preflight 수행.
2. 최신 소스 후보를 전송하고 후보 이미지 빌드. 기존 이미지에 롤백 태그 부여. 인덱싱 중 작업과 구버전 워커 혼합 실행 여부 확인.
3. 환경별 secret을 호스트에서 설정. 로컬 .env를 운영용으로 무조건 복사하지 않음. DB migration 후 AI 서버 readiness와 인증 경계 확인.
4. 전용 테스트 tenant/문서를 생성하고 검증 데모에만 필요한 키를 설정. 운영 업무 데이터와 분리.
5. 확인된 검증 도메인에 인증 프록시 적용 후 검증 데모 시작.
6. Sites 서비스 데모에 AI_SERVER_BASE_URL, STORE_A/B appkey·app ID, 지식 운영자 키, 상담원·관리자 이메일 allowlist를 서버 비밀 설정으로 주입. 로컬 세션 토큰은 주입하지 않음. 검증한 빌드를 기존 비공개 사이트로 배포.
7. 실제 사용자 로그인 후 고객 채팅·출처·근거 부족·매장 전환, 관리자 업로드/색인/보관, 비인가 거절과 검증 리포트를 확인. 테스트 범위와 알려진 상담원 검토함 저장 제한을 함께 인계.

호스트에서의 Compose 예시(저장소 루트 기준, Compose !override 지원 필요):

```sh
docker compose -f docker-compose.yml -f deploy/compose.validation.yml config --quiet
docker compose -f docker-compose.yml -f deploy/compose.validation.yml build
docker compose -f docker-compose.yml -f deploy/compose.validation.yml up -d
```

실제 실행 전 운영 접속 정보와 배포 대상 확인이 필요하다. 이 문서는 배포 완료 기록이 아니다.
