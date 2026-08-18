# 품질 기준선 개선 이력 — 2026-08-18

## 목적

서비스 데모 착수 전에 AI Server와 검증 데모의 로컬 품질 게이트를 정상화합니다. 이 이력은 `QLT-SRV-01`의 typecheck·lint 개선 결과와 남은 작업을 기록합니다.

## 변경 내용

- Jest mock을 현재 타입 시그니처에 맞게 정리했습니다.
- appkey 수명주기 테스트의 mock state 타입을 명시했습니다.
- 관리자 guard 테스트의 `ExecutionContext` mock 경계를 명시했습니다.
- API 노출 계약 테스트가 존재하지 않는 handler를 metadata 대상에 전달하지 않도록 했습니다.
- 문서 `sourceType`이 문자열이 아니면 plain text chunk 전략을 사용하도록 안전하게 처리했습니다.
- 비문자열 `sourceType` 회귀 테스트를 추가했습니다.
- AI Server·검증 데모·서비스 데모 통합 로드맵과 서비스 데모 계획을 추가했습니다.

## 검증 결과

| 검사                              | 결과                  |
| --------------------------------- | --------------------- |
| `npm run build`                   | PASS                  |
| `npx tsc --noEmit`                | PASS, 오류 0건        |
| `npx eslint "{src,test}/**/*.ts"` | PASS, 오류 0건        |
| AI Server unit                    | 16 suites, 67/67 PASS |
| 검증 데모 unit                    | 6/6 PASS              |
| 변경 Markdown Prettier            | PASS                  |

## 미실행 범위

- DB fixture를 변경하는 E2E와 전체 HTTP 계약 suite는 이번 로컬 품질 수정에서 실행하지 않았습니다.
- staging smoke와 실제 Bedrock·S3 장애 주입은 실행하지 않았습니다.

## 남은 품질 작업

- `npm audit` 기준 전체 High 9, Moderate 5이며 production 기준 High 8, Moderate 5입니다.
- `@nestjs/platform-express`, `@nestjs/swagger`, `prisma`는 호환성을 확인한 버전 갱신이 필요합니다.
- `xlsx`는 현재 npm audit에서 자동 수정 경로가 없어 parser 교체 또는 격리 결정이 필요합니다.
- build·typecheck·lint·unit·검증 데모 test를 GitHub Actions 필수 체크로 연결해야 합니다.
- 환경 의존 E2E와 검증 데모 HTTP suite를 격리된 DB에서 자동 실행해야 합니다.

## 판정

로컬 typecheck와 lint 기준선은 정상화됐습니다. `QLT-SRV-01`은 dependency High 정리가 남아 있어 진행 중으로 유지하며, `QLT-DEM-01`은 CI 필수 체크가 연결된 뒤 완료 처리합니다.
