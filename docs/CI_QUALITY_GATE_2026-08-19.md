# CI 품질 게이트 구축 이력 — 2026-08-19

## 목적

AI Server·검증 데모·서비스 데모의 변경이 동일한 로컬·CI 품질 명령을 통과하도록 `QLT-DEM-01` GitHub Actions 기준선을 구성합니다. DB와 AWS credential이 필요한 E2E는 분리하고, 비밀값 없이 반복 가능한 검사부터 필수 게이트로 만듭니다.

## 추가한 명령

| 명령                 | 역할                                                       |
| -------------------- | ---------------------------------------------------------- |
| `npm run typecheck`  | TypeScript emit 없는 검사                                  |
| `npm run lint:check` | 소스를 수정하지 않는 ESLint 검사                           |
| `npm run test:ci`    | AI Server Jest 직렬 실행                                   |
| `npm run test:demo`  | 검증 데모 자체 테스트                                      |
| `npm run verify`     | build → typecheck → lint → 서버 test → 데모 test 통합 실행 |

개발자가 명시적으로 자동 수정을 원할 때 사용하는 기존 `npm run lint`는 유지하고, CI에서는 `lint:check`만 사용합니다.

## Workflow

파일: `.github/workflows/quality-gate.yml`

실행 조건:

- `main`, `codex/**` push
- `main` 대상 pull request
- 수동 `workflow_dispatch`

### Build, lint, and test

- Ubuntu GitHub-hosted runner
- Node.js 24와 npm cache
- `npm ci`
- `npm run verify`
- timeout 15분

### Dependency audit

- package lock 기준 `npm audit`
- Critical 발견 시 실패
- High·Moderate를 포함한 전체 JSON 결과 artifact 보존
- artifact 보존 기간 14일

현재 High 4건은 Prisma CLI 전이 의존성과 XLSX parser로 추적 중이므로 즉시 실패 조건으로 사용하지 않습니다. 잔여 위험이 제거되거나 승인 예외 정책이 확정되면 High를 차단 기준으로 승격합니다.

## 공급망 설정

GitHub 공식 action도 이동 가능한 major tag 대신 확인한 release commit SHA로 고정했습니다.

| Action                    | Release |
| ------------------------- | ------- |
| `actions/checkout`        | 7.0.1   |
| `actions/setup-node`      | 7.0.0   |
| `actions/upload-artifact` | 7.0.1   |

Workflow 권한은 repository contents read로 제한하고, 같은 ref의 이전 실행은 취소하도록 concurrency를 설정했습니다.

## 로컬 검증

| 검사                | 결과                                        |
| ------------------- | ------------------------------------------- |
| Workflow YAML parse | PASS, `quality`·`dependency-audit` job 확인 |
| `npm run verify`    | PASS                                        |
| 운영 build          | PASS, Prisma Client 7.9.1                   |
| typecheck           | PASS                                        |
| ESLint              | PASS                                        |
| AI Server unit      | 16 suites, 67/67 PASS                       |
| 검증 데모 unit      | 6/6 PASS                                    |
| Critical audit gate | PASS, Critical 0                            |
| Audit report        | High 4, Moderate 0 기록 확인                |

## 미포함 범위

- PostgreSQL service container와 DB migration E2E
- 실제 Bedrock·S3 호출
- 검증 데모의 전체 HTTP 계약 suite
- staging smoke와 배포
- GitHub `main` branch protection의 required checks 지정

## 판정과 남은 작업

로컬 workflow 구현과 통합 품질 명령은 완료됐습니다.

2026-08-19 PR 실행 [Quality Gate run 32204175968](https://github.com/kyhoon-hj/hj-ai-server/actions/runs/32204175968)에서 다음 결과를 확인했습니다.

- `Dependency audit`: PASS, audit JSON artifact 업로드
- `Build, lint, and test`: PASS
- 전체 workflow conclusion: success

이후 `Build, lint, and test`와 `Dependency audit`를 `main` PR 필수 체크로 지정하면 `QLT-DEM-01`을 완료 처리합니다. Branch protection 변경은 저장소 운영 정책 변경이므로 별도 승인 작업으로 남깁니다.
