# HJ_AI_Server

NestJS server for AWS Bedrock with Prisma configured for PostgreSQL.

## Setup

```bash
npm install
npm run prisma:generate
npm run db:init
npm run start:dev
```

Copy `.env.example` to `.env` and set AWS credentials in your environment or AWS profile. `BEDROCK_MODEL_ID` can be provided globally or per request.

Set a unique 32-character-or-longer `ADMIN_API_KEY`. It must differ from `APPKEY_JWT_SECRET`; `/app-info/*` requires it in the `x-admin-key` header. Consumer appkeys cannot call administrator APIs.

Consumer appkeys expire after `APPKEY_TTL_DAYS` (90 by default). Rotation can temporarily accept the previous key up to `APPKEY_MAX_ROTATION_GRACE_SECONDS`. Administrator credentials support a deployment-time primary/previous pair with an explicit previous-key expiry. See [Credential lifecycle and audit operations](docs/CREDENTIAL_LIFECYCLE_AND_AUDIT.md).

Set a separate `KNOWLEDGE_OPERATOR_API_KEY` for `/admin/v1/knowledge/apps/:appId/*`. Platform administrators may also call these endpoints, while knowledge operators receive 403 from `/app-info/*`.

For S3 uploads, set `AWS_S3_BUCKET`. `AWS_S3_CDN_URL` is optional and is used to build the returned public file URL.

This project uses PostgreSQL through Prisma 7. Configure `DATABASE_URL` in `.env`, then run `npm run prisma:migrate` to create the test table.

## Standard ports

Local and production origin processes use the same fixed role-based ports: AI Server `11000`, validation demo `11001`, and service demo `11002`. See [application port standard](docs/PORT_STANDARD.md).

## Docker

Build the production image:

```bash
docker build -t hj-ai-server:latest .
```

Run the API as a single Docker service:

```bash
docker compose up -d --build
```

The app listens on container port `11000` and is exposed on `http://localhost:11000`. Process liveness is available at `/health/live`, and DB/config readiness is available at `/health/ready`. Compose reads `DATABASE_URL`, AWS credentials, and Bedrock settings from local `.env`. When the DB host is `localhost` or `127.0.0.1`, the container startup wrapper changes only the hostname to `host.docker.internal`; credentials, port, and database name are preserved.

Set `DOCKER_DATABASE_HOST` only when the Docker host gateway needs a different name. The startup wrapper runs `prisma migrate deploy` before starting the server, and the Compose healthcheck uses `/health/ready` so a disconnected DB is not reported as healthy. For non-Compose deployments, run `npm run db:init` against the configured `DATABASE_URL`.

AWS SDK clients use adaptive retry with explicit connection and total operation limits. `AWS_CONNECTION_TIMEOUT_MS` defaults to `5000`, and `AWS_REQUEST_TIMEOUT_MS` defaults to `30000`. When an HTTP client disconnects or the process receives a shutdown signal, active Bedrock and S3 operations are aborted. The indexing worker waits for an aborted job to persist its retry state before module shutdown completes.

### Local dependency fault E2E

Run the durable knowledge-index job fault scenarios against local PostgreSQL:

```bash
npm run test:fault-e2e
```

The runner refuses a non-local `DATABASE_URL`. It creates an isolated appcode, injects dependency-shaped Bedrock, S3, and Prisma failures at the service boundary, verifies persisted backoff and terminal state, and removes its files, chunks, jobs, and app record. It does not call or disrupt real AWS resources. Normal `npm run test:e2e` skips these seven opt-in scenarios.

### Nginx

Use `/ai/` as the reverse proxy prefix and keep the same prefix when forwarding to the Docker service:

```nginx
location = /ai {
    return 301 /ai/;
}

location /ai/ {
    proxy_pass http://127.0.0.1:11000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_cache_bypass $http_upgrade;
}
```

## APIs

Swagger UI is available at:

```http
GET /ai/docs
```

### Health

```http
GET /ai
```

### Product RAG answer contract

```http
POST /knowledge/answers
Content-Type: application/json
appkey: <app-info appkey>
x-correlation-id: <optional UUID>

{
  "query": "고객 질문",
  "strict": true,
  "includeSources": true,
  "filters": {
    "accessLevels": ["PUBLIC"],
    "businessStatuses": ["PUBLISHED"],
    "productCodes": ["PRODUCT_A"],
    "activeAt": "2026-07-18T00:00:00.000Z"
  },
  "supplementalSources": [
    {
      "sourceType": "SUPPORT_BOARD_APPROVED_ANSWER",
      "sourceId": "answer-message-uuid",
      "title": "제품 설치 방법",
      "content": "전원을 연결한 뒤 설치 마법사를 실행하세요.",
      "publishedAt": "2026-07-20T00:00:00.000Z",
      "relevanceScore": 0.82,
      "productCode": "PRODUCT_A"
    }
  ]
}
```

`filters`를 생략한 기존 소비자의 검색 동작은 유지됩니다. AppInfo의
`allowedAccessLevels`가 설정된 앱은 요청 필터와 무관하게 서버 허용 범위 안에서만
검색합니다. 고객지원 앱은 `["PUBLIC"]`로 프로비저닝합니다. 지식 파일의
`accessLevel`, `businessStatus`, `productCodes`, `effectiveFrom`,
`effectiveTo`는 `PATCH /knowledge/files/:id/policy`로 관리합니다.

`supplementalSources`는 인증된 서버 소비자가 이미 공개·검토한 보조 근거를
전달하는 additive 계약입니다. 최대 5개이며 현재는
`SUPPORT_BOARD_APPROVED_ANSWER`만 허용합니다. 검색 문서가 없어도 보조 근거가
있으면 strict no-answer로 종료하지 않고 답변을 생성하며, 응답의
`retrieval.supplementalCount`와 `sources[].sourceType`으로 구분합니다.

모든 응답은 `x-correlation-id`를 반환합니다. 오류 응답은 기존 Nest
`statusCode`, `message`, `error` 필드에 `code`, `requestId`를 추가합니다.

### Low-risk general answer contract

```http
POST /bedrock/general-answers
Content-Type: application/json
appkey: <app-info appkey>
x-correlation-id: <optional UUID>

{
  "query": "클라우드 컴퓨팅이 무엇인가요?"
}
```

이 endpoint는 인사·감사·안정적인 기본 상식처럼 사전에 허용된 저위험 일반
질문 전용입니다. 요청별 system/model override를 허용하지 않으며
`general-answer-v1.0.0` prompt, temperature `0.1`, max token `500`을 사용합니다.
범위를 벗어나거나 불확실하면 `generalAnswerEligible=false`,
`reviewRecommended=true`를 반환합니다. 고객지원 RAG no-answer fallback으로
사용하지 않습니다.

#### RAG contract migration

배포 전에 중복 appcode를 확인합니다.

```sql
SELECT "appcode", COUNT(*), ARRAY_AGG("id")
FROM "appinfo"
GROUP BY "appcode"
HAVING COUNT(*) > 1;
```

결과가 있으면 소유 앱과 지식을 확인해 중복을 정리한 뒤 `npm run db:init`을
실행합니다. migration은 중복이 남아 있으면 unique index 생성 전에 중단되며
임의로 앱 데이터를 삭제하지 않습니다. 스키마 migration과 하위 호환 서버를 먼저
배포한 후 새 filter를 사용하는 소비자를 배포합니다.

### Converse with Bedrock

```http
GET /ai/bedrock/config
appkey: <app-info appkey>

GET /ai/bedrock/models
appkey: <app-info appkey>
```

```http
POST /ai/bedrock/converse
Content-Type: application/json
appkey: <app-info appkey>

{
  "modelId": "anthropic.claude-3-5-sonnet-20240620-v1:0",
  "message": "Hello",
  "maxTokens": 1024,
  "temperature": 0.7,
  "metadata": {
    "userId": "demo-user"
  }
}
```

### Upload file to S3

```http
POST /ai/storage/upload
Content-Type: multipart/form-data
appkey: <app-info appkey>

file: <binary file>
```

Files are stored under an app-specific S3 key prefix:

```text
<appcode>/<yyyy>/<mm>/<dd>/<uuid>-<filename>
```

```http
GET /ai/storage/files
appkey: <app-info appkey>
```

```http
GET /ai/storage/files/detail?key=<appcode/yyyy/mm/dd/uuid-filename>
appkey: <app-info appkey>
```

```http
GET /ai/storage/download?key=<appcode/yyyy/mm/dd/uuid-filename>
appkey: <app-info appkey>
```

### Test table CRUD

```http
POST /ai/test-tables
GET /ai/test-tables
GET /ai/test-tables/:id
PATCH /ai/test-tables/:id
DELETE /ai/test-tables/:id
```
