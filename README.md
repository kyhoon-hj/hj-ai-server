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

This project uses PostgreSQL through Prisma 7. Configure `DATABASE_URL` in `.env`, then run `npm run prisma:migrate` to create the test table.

## Docker

Build the production image:

```bash
docker build -t hj-ai-server:latest .
```

Run the API as a single Docker service:

```bash
docker compose up -d --build
```

The app listens on container port `11000` and is exposed on `http://localhost:11000`. Compose reads `DATABASE_URL`, AWS credentials, and Bedrock settings from local `.env`.

For Docker-specific local settings, copy `.env.docker.example` values into `.env` or set them in your deployment environment. Run database migrations separately with `npm run db:init` against the configured `DATABASE_URL`.

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

### Converse with Bedrock

```http
GET /ai/bedrock/config
GET /ai/bedrock/models
```

```http
POST /ai/bedrock/converse
Content-Type: application/json

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

### Test table CRUD

```http
POST /ai/test-tables
GET /ai/test-tables
GET /ai/test-tables/:id
PATCH /ai/test-tables/:id
DELETE /ai/test-tables/:id
```
