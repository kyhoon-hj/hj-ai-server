# 의존성 감사 개선 이력 — 2026-08-18

## 목적

`QLT-SRV-01`의 production dependency High 취약점을 안전한 같은 메이저 버전 업데이트로 줄이고, 자동 수정할 수 없는 잔여 위험을 분리합니다.

## 적용한 업데이트

| 패키지                     |    이전 |   적용 |
| -------------------------- | ------: | -----: |
| `@nestjs/common`           | 11.1.27 | 11.2.1 |
| `@nestjs/core`             | 11.1.27 | 11.2.1 |
| `@nestjs/platform-express` | 11.1.27 | 11.2.1 |
| `@nestjs/testing`          | 11.1.27 | 11.2.1 |
| `@nestjs/swagger`          |  11.4.4 | 11.4.7 |
| `@prisma/adapter-pg`       |   7.8.0 |  7.9.1 |
| `@prisma/client`           |   7.8.0 |  7.9.1 |
| `prisma`                   |   7.8.0 |  7.9.1 |

`npm audit fix`로 `multer`, `js-yaml`, `brace-expansion`, `fast-uri` 등 자동 수정 가능한 전이 의존성도 안전 버전으로 갱신했습니다. `--force`는 사용하지 않았습니다.

## 감사 결과

| 범위                  |            변경 전 |            변경 후 |
| --------------------- | -----------------: | -----------------: |
| 전체 dependency       | High 9, Moderate 5 | High 4, Moderate 0 |
| production dependency | High 8, Moderate 5 | High 4, Moderate 0 |

해소된 직접 경로는 NestJS platform-express의 `multer`와 Swagger의 `js-yaml`입니다. 개발 도구 경로의 `brace-expansion`, `fast-uri`도 함께 해소됐습니다.

## 잔여 위험

### Prisma CLI 전이 의존성

- `prisma` → `@prisma/config` → `deepmerge-ts` 경로가 High로 보고됩니다.
- 현재 npm의 자동 수정 제안은 Prisma 6.12.0 강제 다운그레이드이며 메이저 역행입니다.
- 애플리케이션은 Prisma 7 API와 adapter 구성을 사용하므로 자동 강제 수정은 적용하지 않았습니다.
- 안전한 Prisma 7 수정 버전이 제공되면 `prisma`, `@prisma/client`, `@prisma/adapter-pg`를 같은 버전으로 함께 갱신합니다.

### XLSX parser

- `xlsx` 0.18.5는 prototype pollution과 ReDoS 경고가 있으며 npm registry에 자동 수정 버전이 없습니다.
- 외부 업로드 문서를 처리하므로 단순 위험 수용으로 완료하지 않습니다.
- `KNW-SRV-06`에서 parser 교체 또는 격리를 수행하고, 그 전까지 파일 크기·MIME·처리 시간 제한을 우선 적용합니다.

## 회귀 검증

| 검사               | 결과                           |
| ------------------ | ------------------------------ |
| `npm run build`    | PASS, Prisma Client 7.9.1 생성 |
| `npx tsc --noEmit` | PASS                           |
| ESLint             | PASS                           |
| AI Server unit     | 16 suites, 67/67 PASS          |
| 검증 데모 unit     | 6/6 PASS                       |

## 판정

자동 수정 가능한 High·Moderate 경로는 해소됐고 기존 기능 회귀는 발견되지 않았습니다. High 4건은 Prisma CLI 전이 경로와 XLSX parser에 한정됩니다. `QLT-SRV-01`은 잔여 두 경로가 제거되거나 승인된 격리·위험 수용 문서가 마련될 때까지 진행 중으로 유지합니다.
