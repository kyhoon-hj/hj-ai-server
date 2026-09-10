# Family RAG 비활성 운영 배포

배포일: 2026-09-10 KST  
릴리스: `20260910-01`  
소스 커밋: `54dfb39f5f723517959c3f437030f4cfeb69ac08`

## 배포 결과

- EC2 `i-0c6431bf77d888faf`의 AI Server 앱 컨테이너만 교체했다.
- 운영 PostgreSQL migration을 13개에서 16개로 적용했다.
- 새 컨테이너 `hj-ai-server:20260910-01`은 healthy 상태다.
- 검증 데모 `hj-ai-validation:20260907-03`은 재시작하지 않고 healthy 상태를 유지했다.
- `FRAME_FAMILY_RAG_ENABLED=false`를 유지했다.
- 유효한 운영 AppKey로 Family 검색 API를 호출했을 때 의도한 비노출 계약인 HTTP
  404를 확인했다. 실제 Family 지식 수집·검색·대화 및 Bedrock 호출은 실행하지 않았다.

배포 이미지는 Git archive로 생성해 Git metadata가 없는 상태다. 이미지 내부
fingerprint는 `9e07ee1ab3962471575cb3888ebfd4e79cb0a4d85e06001f3cbbab04c5760de8`이며,
Windows CRLF 작업 트리에서 계산한 fingerprint와 구분한다.

## 백업과 복구

- 릴리스: `/home/ubuntu/hj-ai-releases/20260910-01`
- 백업: `/home/ubuntu/hj-ai-backups/20260910-01`
- DB custom dump: `hj-ai.dump`, `pg_restore --list` 검증 완료
- DB dump SHA256: `e57afd0b03b834fa8030d5451d2dc96aaaaaa70a3d540b1d7e7863a5b018a3ed`
- 이전 앱 이미지: ECR digest
  `sha256:b940f5370d52ef79843ed602aad114fa0ab7635557b77e509a2f6fe73e96f96f`
- rollback 로컬 태그: `hj-ai-server:rollback-20260910-01`

후보 또는 전환 검증 실패 시 이전 P4 릴리스의
`deploy/compose.production.yml`과 `deploy/p4-image.json`을 함께 사용하도록 자동
rollback을 구성했다. 실제 rollback은 실행되지 않았다. migration 3개는 additive
schema이므로 앱 이미지 rollback과 DB 복원은 분리한다. DB 복원은 쓰기 영향 검토와
별도 승인 없이 실행하지 않는다.

## 검증

```text
후보 /health/live                         200
후보 /health/ready                        200
후보 무인증 /app-info                     401
후보 Swagger 경로                         404
운영 공개 /health/live                    200
운영 공개 /health/ready                   200
운영 무인증 /app-info                     401
운영 Swagger 경로                         404
운영 Family API, 기능 비활성 + 유효 AppKey 404
Prisma migration                           16개, up to date
최근 앱 error/exception/fatal 로그         0건
배포 직후 메모리                           약 150 MiB
호스트 디스크 여유                         약 12 GiB
```

주요 SSM Run Command 식별자는 다음과 같다.

- 후보 준비: `bcfb590b-debf-4833-8031-dc05bbcd3368`
- 운영 전환: `3e550bfb-9abf-46ef-aacd-bdb3e9cb7256`

## 남은 작업

EC2 인스턴스 역할에 ECR blob push 권한이 없어
`608311474994.dkr.ecr.ap-northeast-2.amazonaws.com/hj-ai-server:20260910-01`
push가 HTTP 403으로 실패했다. 운영 이미지는 현재 EC2 로컬 image store에만 있으므로
정리 작업에서 삭제하면 재빌드가 필요하다. ECR push 권한 또는 별도 빌드 파이프라인을
확보한 뒤 동일 소스 SHA의 이미지를 registry에 보존해야 한다.

다음 활성화 단계는 정확한 ZINFrame appcode allowlist, 실제 provider 이벤트 fixture,
삭제/재수신 절차와 즉시 비활성화 기준을 합의한 뒤 진행한다.
