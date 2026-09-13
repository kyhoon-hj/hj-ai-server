# 애플리케이션 포트 표준

적용일: 2026-08-21

로컬, Docker와 운영 환경에서 애플리케이션 역할별 포트를 다르게 재할당하지 않습니다.

| 구성요소 | 로컬 | Docker/운영 | 상태 |
|---|---:|---:|---|
| AI Server | 11000 | 11000 | 구현·실행 중 |
| 검증 데모 | 11001 | 11001 | 구현·실행 설정 반영 |
| 서비스 데모 | 11002 | 11002 | 포트 설정 고정, 애플리케이션 구현 예정 |
| AI Console Web/BFF | 11003 | 11003 | 앱 관리 화면 구현·실행 설정 반영 |

## 적용 규칙

- 공통 기준값은 `config/standard-ports.mjs`에서 관리합니다.
- 검증 데모의 `DEMO_PORT`는 생략하거나 11001만 사용할 수 있습니다.
- 서비스 데모의 `SERVICE_DEMO_PORT`는 생략하거나 11002만 사용할 수 있습니다.
- AI Console Web/BFF의 `CONSOLE_WEB_PORT`는 생략하거나 11003만 사용할 수 있습니다.
- AI Server CORS allowlist에는 로컬 검증 데모, 서비스 데모와 AI Console origin을 함께 등록합니다.
- 운영 배포에서도 컨테이너 내부 포트와 origin proxy upstream 포트에 같은 번호를 사용합니다.
- 외부 HTTPS 사용자 URL이 443을 사용하더라도 origin 애플리케이션 포트 표준은 바꾸지 않습니다.

저장소의 Docker Compose에는 세 포트를 운영 표준 metadata로 기록했습니다. 현재 Compose가 실제로 실행하는 서비스는 AI Server뿐이며, 검증·서비스 데모의 운영 컨테이너와 reverse proxy 반영은 각 배포 작업에서 확인해야 합니다.
