# HJ Mart Assist Service Demo

마트 고객·상담원·매장 관리자가 HJ AI Server를 사용하는 소비자 관점의 독립 서비스 데모입니다. S0 기반과 함께 고객 채팅, 추천 질문, 근거 source, strict no-answer와 상담원 검토 요청 화면을 제공합니다.

## 실행

Node.js 22.13 이상에서 다음 명령을 실행합니다.

```powershell
npm install
npm run dev:connected
```

브라우저에서 `http://127.0.0.1:11002`를 엽니다. AI Server 기본 대상은 `http://127.0.0.1:11000`입니다.

- 고객 채팅: `http://127.0.0.1:11002/chat`
- 상담원 검토함: `http://127.0.0.1:11002/agent`
- 매장 관리자 지식관리: `http://127.0.0.1:11002/knowledge`

`dev:connected`는 루트 `.env`의 관리자 키로 STORE_A/STORE_B appkey를 회전하고, git에서 제외된 `.dev.vars`에 연결 정보를 기록한 뒤 개발 서버를 시작합니다. appkey는 콘솔·브라우저 응답·저장소에 포함하지 않습니다.

지식관리 API는 플랫폼 인증 이메일과 `SERVICE_DEMO_MANAGER_EMAILS` allowlist를 함께 확인하며, AI Server 지식 운영자 키는 BFF에서만 사용합니다. `dev:connected`는 localhost에서만 사용할 수 있는 임의 토큰을 생성하고 same-origin 요청에 HttpOnly 관리자 세션을 발급하므로 로컬 미리보기에서도 지식관리 화면을 테스트할 수 있습니다. 이 경로는 localhost가 아닌 환경에서는 닫힙니다.

상담원 화면은 `SERVICE_DEMO_AGENT_EMAILS` allowlist와 관리자와 분리된 HttpOnly 로컬 세션을 사용합니다. 현재는 역할 경계와 준비 상태까지 제공하며, 영구 검토함 저장과 피드백 처리는 S2 장애·운영 UX 단계에서 연결합니다.

수동으로 실행하려면 `.dev.vars`에 다음 서버 전용 값을 설정한 뒤 `npm run dev`를 실행합니다.

```dotenv
AI_SERVER_API_PREFIX=""
AI_SERVER_APPKEY_STORE_A="STORE_A의 서버 전용 appkey"
AI_SERVER_APPKEY_STORE_B="STORE_B의 서버 전용 appkey"
```

포트는 환경과 무관하게 다음 값으로 고정합니다.

- 서비스 데모: `11002`
- AI Server: `11000`

`SERVICE_DEMO_PORT`에 11002 외 값을 설정하면 시작 설정이 실행을 거절합니다.

## 구조와 보안 경계

```text
browser → service-demo /api BFF → AI Server public API
```

- 브라우저에는 관리자·운영자 credential을 저장하지 않습니다.
- `lib/fixtures.ts`는 가상 ID와 비식별 데이터만 사용합니다.
- `lib/api-client.ts`는 UUID correlation ID, 5초 timeout, 구조화 오류와 재시도 가능 여부를 공통 처리합니다.
- `/api/health`는 BFF에서 `/health/ready`를 호출하고 준비·저하·오프라인 상태를 구분합니다.
- `/api/answers`는 tenant allowlist로 매장을 확인한 뒤 해당 서버 전용 appkey로 `/knowledge/answers`를 호출합니다. prefix를 사용하는 환경은 `AI_SERVER_API_PREFIX`로 지정합니다.
- `/api/knowledge/files`는 허용된 매장 관리자만 목록·업로드·인덱싱·재인덱싱·보관을 실행하도록 제한합니다. 새 문서는 고객 검색 대상이 되도록 `PUBLIC + PUBLISHED` 정책 적용에 성공한 뒤 인덱싱합니다.
- 브라우저에는 source의 파일명·페이지·상품코드·관련도만 전달하며 S3 key, 원문 content와 내부 metadata는 제거합니다.

## 검증

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Fixture 버전은 `svc-s0-v1`입니다. 현재 상담원 검토 요청은 세션 내 접수 상태까지 제공하며, 영구 검토함 저장은 후속 운영 UX 단계에서 연결합니다.
