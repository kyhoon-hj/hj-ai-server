# AWS 운영 AI 서버 실측 구성

> 후속: 현재 운영은 [2026-09-06 배포 기록](PRODUCTION_DEPLOYMENT_2026-09-06.md)을 참조한다. 아래는 업데이트 전 실측이며 기존 소스 경로와 이미지·migration 개수는 과거 상태다.

2026-09-05 AWS CLI 및 SSM 읽기 전용 명령으로 확인. 운영 서비스·설정·DB 변경 없음.

## 연결 경로

`https://ai.hjshub.com` → CloudFront `EWL2WT7KZR60R` → EC2 `54.116.171.29:80` → Nginx Host 라우팅 → `127.0.0.1:11000` → `hj-ai-server-app-1`.

| 항목 | 실측 값 |
|---|---|
| EC2 이름 / ID | works-server / i-0c6431bf77d888faf |
| 리전 / 타입 | ap-northeast-2 / t3a.medium |
| OS / 관리 경로 | Ubuntu 26.04 / Systems Manager Online, Run Command 성공 |
| 공개 / 내부 IP | 54.116.171.29 / 172.31.35.15 |
| 소스·Compose 위치 | /home/ubuntu/hj-ai-server/docker-compose.yml |
| 컨테이너 / 이미지 | hj-ai-server-app-1 / hj-ai-server:latest |
| 이미지 ID | sha256:7f504f42cb327167b25445d9d183940cb5a7e7e5d2aacc54e3c17d4de39a7839 |
| Node | v24.18.0 |
| DB endpoint | hj-erp-saas-db.c1agm0gumu8a.ap-northeast-2.rds.amazonaws.com |
| DB / 스키마 | hj-ai / public |
| Nginx 설정 | /etc/nginx/sites-available/default (sites-enabled/default symlink) |

CloudFront는 여러 HJ 서비스 도메인이 공유한다. origin은 HTTP-only 80이며 host별 Nginx 라우팅이다. 기본 캐시 정책 UseOriginCacheControlHeaders: min/default TTL 0, max 31,536,000. 전체 배포 설정 변경은 다른 도메인에도 영향을 줄 수 있다.

## 현재 버전과 배포 전 차이

- 운영 root HTTP 200, origin 및 공개 readiness HTTP 404. 프로세스는 실행 중이지만 최신 readiness 계약은 없음.
- 운영 이미지의 Prisma migration status: 8개 migration, 해당 이미지 기준 up-to-date. 현재 저장소는 13개이므로 최신 소스 기준 최신 DB라는 의미가 아님.
- 컨테이너 환경에는 DATABASE_URL, APPKEY_JWT_SECRET, AWS 정적 credential, 모델·버킷 설정이 존재. 값은 수집·출력하지 않았다. ADMIN_API_KEY / KNOWLEDGE_OPERATOR_API_KEY는 확인되지 않음.
- 동일 EC2에 총 17개 컨테이너와 여러 다른 서비스가 실행 중. 시스템 전체 변경이나 일괄 컨테이너 재시작을 피하고 AI 프로젝트만 배포해야 함.
- 표본 자원: RAM 약 3.8GiB, available 약 1.65GiB; swap 2GiB 중 약 83MiB 사용; 루트 디스크 48GiB 중 24GiB 여유. 이는 읽은 시점의 수치다.
- root SSM에서 Git 조회는 소유권 검사로 거절되어 commit SHA 미확인. global safe.directory 설정을 변경하지 않았다. 소유자 계정으로 후속 조회 가능.

## 후속 배포

SSH 정보 없이 SSM으로 관리 가능함을 확인했으므로 접속 정보 부재는 더 이상 차단 사유가 아니다. 다음은 운영 소스/변경 상태 확인, DB 백업과 누락 migration 영향 검토, AI 전용 관리자/운영자 키 준비, 후보 이미지 배포다. 기존 이미지·DB 복구 경로를 보존하고 그 뒤 두 데모를 연결한다.

검증 데모의 외부 주소와 접근 방식은 아직 확정되지 않았다. 서비스 데모는 기존 owner-only Sites 주소를 사용할 수 있다. 운영 API의 정상 접속을 서버 업데이트 완료와 혼동하지 않는다.

기존 `OPERATIONS_INFRASTRUCTURE_AS_IS.md`는 로컬과 공개 관측을 구분한 과거 기록이며 당시 CloudFront 리소스 조회 권한이 없어 원격 origin을 확정하지 못했다. 이번 문서가 원격 구성에 대한 최신 확인 기록이다.
