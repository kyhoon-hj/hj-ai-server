# HJ Mart Assist Service Demo

마트 고객·상담원·매장 관리자가 HJ AI Server를 사용하는 소비자 관점의 독립 서비스 데모입니다. 현재 S0 기반 단계는 페르소나와 대표 여정, 비식별 fixture, 공통 API 오류·correlation 처리, AI Server 준비 상태 표시를 제공합니다.

## 실행

Node.js 22.13 이상에서 다음 명령을 실행합니다.

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:11002`를 엽니다. AI Server 기본 대상은 `http://127.0.0.1:11000`이며 `.env.local`의 `AI_SERVER_BASE_URL`로 변경할 수 있습니다.

포트는 환경과 무관하게 다음 값으로 고정합니다.

- 서비스 데모: `11002`
- AI Server: `11000`

`SERVICE_DEMO_PORT`에 11002 외 값을 설정하면 시작 설정이 실행을 거절합니다.

## 구조와 보안 경계

```text
browser → service-demo /api BFF → AI Server public /v1
```

- 브라우저에는 관리자·운영자 credential을 저장하지 않습니다.
- `lib/fixtures.ts`는 가상 ID와 비식별 데이터만 사용합니다.
- `lib/api-client.ts`는 UUID correlation ID, 5초 timeout, 구조화 오류와 재시도 가능 여부를 공통 처리합니다.
- `/api/health`는 BFF에서 `/health/ready`를 호출하고 준비·저하·오프라인 상태를 구분합니다.

## 검증

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Fixture 버전은 `svc-s0-v1`입니다. 다음 단계에서는 비활성 상태인 `대화 시작`을 실제 `/v1` 질의·근거 표시 흐름에 연결합니다.
