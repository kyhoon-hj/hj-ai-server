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

Run the API with PostgreSQL through Docker Compose:

```bash
docker compose up -d --build
```

The app is exposed on `http://localhost:11000` by default. Compose reads AWS credentials from local `.env`, keeps the application listening on container port `3000`, runs `prisma migrate deploy`, and then starts the NestJS server.

For Docker-specific local settings, copy `.env.docker.example` values into `.env` or set them in your deployment environment. To use an external database instead of the Compose PostgreSQL service, set `DOCKER_DATABASE_URL`.

## APIs

Swagger UI is available at:

```http
GET /api
```

### Health

```http
GET /
```

### Converse with Bedrock

```http
GET /bedrock/config
GET /bedrock/models
```

```http
POST /bedrock/converse
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
POST /test-tables
GET /test-tables
GET /test-tables/:id
PATCH /test-tables/:id
DELETE /test-tables/:id
```
