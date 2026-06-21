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
