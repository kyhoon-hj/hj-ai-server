# HTTP 노출 보안 정책

## 목적

브라우저 CORS와 Swagger 문서 노출을 환경별 명시 설정으로 제한합니다. 이 정책은 API 자체 인증을 대체하지 않으며, 외부 앱은 기존 `appkey` 또는 관리자 role credential을 계속 사용해야 합니다.

## 환경 변수

| 변수 | 운영 기본값 | 설명 |
|---|---|---|
| `NODE_ENV` | `production` | 운영 이미지와 Compose에서 명시합니다. |
| `CORS_ALLOWED_ORIGINS` | 빈 값 | 쉼표로 구분한 정확한 `http(s)` Origin입니다. 빈 값이면 CORS middleware를 활성화하지 않습니다. |
| `SWAGGER_ENABLED` | `false` | 환경과 무관하게 `true`를 명시한 경우에만 Swagger를 생성합니다. |
| `SWAGGER_PATH` | `api-docs` | 선행·후행 slash가 없는 상대 경로입니다. |

`CORS_ALLOWED_ORIGINS`는 `*`, URL path, query, fragment와 http/https 이외 scheme을 거절합니다. credential CORS를 사용하므로 wildcard는 허용하지 않습니다.

```dotenv
NODE_ENV=production
SWAGGER_ENABLED=false
SWAGGER_PATH=api-docs
CORS_ALLOWED_ORIGINS=https://admin.example.com,https://app.example.com
```

## 동작 기준

| 조건 | 결과 |
|---|---|
| 운영, `SWAGGER_ENABLED` 미설정 또는 `false` | Swagger UI·JSON route를 생성하지 않음 |
| 운영, `SWAGGER_ENABLED=true` | 지정된 `SWAGGER_PATH`에 문서 생성 |
| CORS allowlist 빈 값 | CORS 허용 응답 헤더 없음 |
| 정확히 일치하는 Origin | 해당 Origin과 credential CORS 헤더 반환 |
| allowlist에 없는 Origin | `Access-Control-Allow-Origin` 미반환 |

Swagger를 운영에서 일시 활성화해야 한다면 reverse proxy 또는 별도 네트워크 계층 인증을 함께 적용하고, 점검 후 다시 비활성화합니다.

## 검증

데모 콘솔의 `자동 계약 검증 → HTTP 노출 보안 검증`을 실행합니다. 검증 대상의 Swagger 경로와 허용 Origin을 연결 설정에 입력하면 다음 네 항목을 확인합니다.

1. Swagger 경로 404
2. 비허용 Origin에 CORS 허용 헤더 없음
3. 비허용 preflight에 CORS 허용 Origin 없음
4. allowlist Origin에만 정확한 Origin·credential 헤더 반환

운영 배포 전에는 reverse proxy/CDN 응답에서도 같은 검사를 반복해야 합니다. 로컬 애플리케이션 검증만으로 CDN cache behavior나 proxy header 재작성까지 증명되지는 않습니다.
