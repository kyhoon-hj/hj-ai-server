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

### XLSX parser — 2026-08-30 해소

- `xlsx` 0.18.5의 prototype pollution과 ReDoS 경고는 단순 위험 수용하지 않았습니다.
- `KNW-SRV-06`에서 해당 패키지를 제거하고 `read-excel-file` 9.3.10으로 교체했습니다.
- legacy XLS 허용을 제거하고 XLSX 처리 상한과 실제 parser 회귀를 적용했습니다.

## 회귀 검증

| 검사               | 결과                           |
| ------------------ | ------------------------------ |
| `npm run build`    | PASS, Prisma Client 7.9.1 생성 |
| `npx tsc --noEmit` | PASS                           |
| ESLint             | PASS                           |
| AI Server unit     | 16 suites, 67/67 PASS          |
| 검증 데모 unit     | 6/6 PASS                       |

## 판정

자동 수정 가능한 High·Moderate 경로는 해소됐고 기존 기능 회귀는 발견되지 않았습니다.

## 2026-08-30 후속 처리

- `xlsx` 0.18.5를 제거하고 `read-excel-file` 9.3.10으로 XLSX 읽기 경로를 교체했습니다.
- 대체 parser가 지원하지 않는 legacy XLS 업로드 허용을 제거했습니다.
- `npm audit` High는 4건에서 3건으로 감소했으며, 잔여 항목은 Prisma CLI의 `deepmerge-ts` 전이 경로뿐입니다.
- 실제 PDF·DOCX·XLSX parser metadata·검색 회귀 6/6과 지식 전체 생명주기 6/6이 통과했습니다.

`QLT-SRV-01`은 잔여 Prisma CLI 경로가 제거되거나 승인된 개발 도구 예외 정책이 확정될 때까지 진행 중으로 유지합니다.
