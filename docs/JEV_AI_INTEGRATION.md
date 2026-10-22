# Jev AI 서버 연동

작성일: 2026-10-22. 이 문서는 `https://jev-ai.pro`의 호환 API 연동을 설명한다.
TypeSafe가 발행한 SDK와 Jev AI가 제공하는 호환 서비스는 구분한다.

## 구현 범위

- 신규 SDK 의존성 없이 Node.js 기본 `fetch`를 사용하는 `src/jev/jev-client.ts`를 공유한다.
- 실제 목적지는 `https://jev-ai.pro/api`로 고정 검증한다. 다른 호스트, HTTP, `/api` 누락 또는 `/v1` 중복을 거절한다.
- 모델 조회: `GET https://jev-ai.pro/api/v1/models`.
- 판단 요청: `POST https://jev-ai.pro/api/v1/systemone`, 기본 모델 `jev-latest`.
- 모든 호출은 서버 전용 `JEV_AI_API_KEY`를 Bearer 인증으로 사용한다. 리다이렉트와 다른 제공자로의 자동 대체를 허용하지 않는다.
- SDK 클라이언트가 추가되는 경우에도 실제 사용하는 인스턴스에 `baseURL: 'https://jev-ai.pro/api'`를 명시해야 한다. 키만 교체해서는 목적지가 바뀌지 않는다.

## 로컬 설정

프로젝트 루트의 Git 제외 파일 `.env`에 키를 직접 설정한다. 발급 위치는
[Jev AI API 페이지](https://jev-ai.pro/jev-api)다. 키를 채팅, 명령 인자, 브라우저 코드,
Git 파일 또는 로그에 넣지 않는다. `.env.example`에는 빈 키와 공개 설정만 둔다.
기존 `.env`를 예제 파일로 덮어쓰지 않는다.

```dotenv
JEV_AI_API_KEY=""
JEV_AI_BASE_URL="https://jev-ai.pro/api"
JEV_AI_MODEL="jev-latest"
JEV_AI_TIMEOUT_MS="3000"
JEV_AI_RAG_MODE="off"
JEV_AI_RAG_APPCODES=""
```

위 빈 키를 실제 값으로 로컬에서만 채운다. 프로세스 환경값이 `.env`보다 우선한다.
기존 서버는 설정 변경 후 재시작해야 한다. CLI는 매 실행 시 같은 루트 `.env`를 읽는다.

## 추론 없이 연결 확인

프로젝트 루트에서 다음을 실행한다. 개발 의존성의 기존 `ts-node`를 사용하며 DB나 AWS 연결은 필요 없다.

```powershell
npm run jev:check
```

공유 클라이언트가 실제 사용할 목적지, 기본 모델 및 재시도 횟수 0을 출력하고,
인증된 모델 조회를 단 한 번 실행한다. `modelLookup: "ok"`, `modelAvailable: true`,
`inferenceCalls: 0`을 확인한다. 키가 없으면 네트워크 호출 전에 중단한다.
이 확인만으로 이후 유료 추론의 성공까지 보장하지는 않는다.

## 잔액을 사용하는 작은 판단 1회

```powershell
npm run jev:decision -- --use-balance
```

먼저 같은 모델 조회를 수행하고, 모델이 있으면 다음 내용으로 판단 요청을 한 번만 보낸다.
`--use-balance`가 없으면 유료 요청을 보내지 않는다.

```json
{
  "model": "jev-latest",
  "state": "I was charged twice for the same subscription.",
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Which team should handle this support ticket?",
      "criteria": { "billing": null, "technical": null, "other": null }
    }
  }
}
```

실제 `answers.category`, 선택 확률과 확신도, `usage`, 청구 헤더에서 읽은 `billing`을 출력한다.
성공 시 API 사용 내역에서 잔액 차감도 확인한다. 응답이 유실되면 아래 오류 정책에 따라
사용 내역을 확인하기 전까지 명령을 반복하지 않는다.

## 배포 설정

- 로컬 Docker Compose는 루트 `.env`를 `app` 서비스에 전달한다.
- 운영 `deploy/compose.production.yml`의 `app.env_file`도 `.env`를 사용한다. **실제 배포 명령의 Compose 프로젝트 디렉터리를 기준으로 해석되는 해당 비밀 파일**에 동일 설정을 직접 넣는다. 파일 접근을 운영 계정으로 제한한다.
- 외부 배포 시스템을 사용하면 애플리케이션 컨테이너의 런타임 비밀 설정에 `JEV_AI_API_KEY`를 등록한다. 빌드 인자나 이미지에 키를 넣지 않는다.
- 공개 설정도 같은 서버 런타임에 주입하고 컨테이너를 재생성한다. 단순 `restart`만으로 Compose의 변경된 환경이 반영되는 것은 아니다.
- API 키는 AI 서버에만 전달한다. `service-demo`, 검증 데모 또는 Console 브라우저에 전달하지 않는다.
- 이 변경은 운영 배포를 실행하지 않는다. 기본 `off`로 배포하면 RAG에서 Jev를 호출하지 않는다.

## 고객문의 선분류 후 Bedrock RAG 생성

고객문의를 먼저 분류해 답변 지침에 반영하려면 AI 서버에서 다음을 설정한다.

```dotenv
JEV_AI_RAG_MODE="classify"
JEV_AI_RAG_APPCODES="hj-ai-demo-store-a,hj-ai-demo-store-b"
```

처리 순서는 앱 인증·자료 접근 필터·사용량 예약 → Jev 문의 분류 → 기존 자료 검색 →
분류별 서버 지침을 포함한 Bedrock Converse 답변 생성 → 기존 JSON·근거 검증 → 기록이다.
외부 Jev에 전송하는 상태는 고객의 질문만 포함한다. 답변·검색 문서·앱 식별자·인증정보는 보내지 않는다.
분류 결과로 검색 범위나 접근 권한을 넓히지 않으며, 자료가 없으면 기존 strict 답변 보류 규칙을 적용한다.

| 분류 | Bedrock에 적용하는 답변 지침 |
|---|---|
| `product` | 상품·가격·재고·위치를 확인하고 등록 값과 실시간 값을 구분 |
| `refund_exchange` | 교환·반품·환불의 기한과 조건 대조, 처리 완료 약속 금지 |
| `shipping_order` | 주문·배송 정책 안내, 실제 주문 상태 추측 금지 |
| `billing_payment` | 결제·청구 절차 안내, 실제 조회·취소 수행 주장 금지 |
| `technical_support` | 근거에 있는 설치·사용·오류 해결 순서 안내 |
| `store_info` | 운영시간·시설 안내, 일부 위치의 전체 구조 일반화 방지 |
| `complaint` | 불편 인정 및 근거가 있는 해결·상담 절차 안내 |
| `other` | 복합·불명확 문의의 일반 근거 지침 |

선택 확률과 confidence가 **모두 0.7 이상**일 때 해당 유형 지침을 적용한다.
낮은 확신도는 `other`의 일반 지침으로 처리한다. 오류·잔액 부족·시간 초과는 기존 RAG로 진행한다.
이 기준은 초기 운영 정책이며 보정된 정확도를 의미하지 않는다.
Jev가 반환한 임의 텍스트를 지침으로 사용하지 않고 서버의 고정된 유형별 문구만 적용한다.

선분류는 `knowledge_query_log.execution.jevClassification`에 별도 기록한다.
모델·확률·confidence·적용 유형·시간·청구량을 보관하고, 적용한 지침은 `inquiryGuidanceSha256`으로 식별한다.
Bedrock 입력 토큰 예약에는 추가 지침을 포함한다. Jev 사용량은 Bedrock 토큰 합계와 분리한다.
고객 공개 응답 형식은 유지하며 분류 상세나 API 키를 브라우저에 전달하지 않는다.

`classify` 모드에서는 생성 후 shadow 평가를 호출하지 않는다. 허용 앱 문의당 최대 1회만 Jev를 호출한다.
근거가 없거나 분류 응답 파싱이 실패해도 이미 실행된 분류 요청 비용은 발생할 수 있다.
자동 재전송은 하지 않는다. 실패의 처리 결과·잔액을 확인한 뒤 새 요청 여부를 결정한다.

로컬 재시작:

```powershell
node scripts/jev-local-demo.mjs server classify
# 별도 터미널에서
npm --prefix service-demo run dev
```

2026-10-22 실제 7문항 검증과 비용은 [선분류 연동 결과](JEV_AI_INQUIRY_ROUTING_2026-10-22.md)를 참조한다.

## 선택형 RAG 비교 모드

로컬 또는 검증 환경의 정확한 appcode를 명시한다.

```dotenv
JEV_AI_RAG_MODE="shadow"
JEV_AI_RAG_APPCODES="your-test-appcode"
```

`KnowledgeService.createRagResponse()`에서 기존 생성·JSON 검증 후, 검색 문서와 승인된 보조 근거의
관련성 및 생성 답변의 인용 근거를 **하나의 추가 요청**으로 평가한다. 문서별 평가 질문과
답변 근거 질문을 묶는다. 이 초기 버전은 생성 전에 문서를 제외하거나 자동 게시를 차단하지 않는다.

평가 결과는 `knowledge_query_log.execution.jev`에만 기록한다. 고객 응답, 답변 가능 여부,
인용 번호 및 기존 Bedrock `usage`/할당량 합계는 유지한다. 총 `latencyMs`에는 추가 호출 시간이 포함되며,
기존 `retrievalMs`/`generationMs`와 별도로 Jev `durationMs`를 기록한다.

- 서버 설정은 `off`, `shadow`, `classify`를 허용한다. `shadow`와 `classify`에는 키와 비어 있지 않은 앱 목록이 필수다.
- 비허용 앱, 원문 기록 금지 앱, 취소된 요청, 근거가 없는 요청은 평가하지 않는다.
- 외부에는 질문·답변·근거 본문과 임시 인용 번호만 전달한다. 인증정보, 저장소 경로, 원본 식별자 및 내부 메타데이터를 전달하지 않는다.
- 허용 목록 등록은 해당 앱 자료의 외부 제공 범위를 검토한 뒤 한다. 기록 금지 앱을 우회하는 설정은 제공하지 않는다.
- Jev 장애는 비교 기록에만 남기고 기존 답변을 유지한다. 이는 자동 게시의 필수 검증 모드가 아니다.
- 이 단계의 평가에는 실제 계정 잔액이 사용된다. 목록의 각 요청마다 최대 한 번 추가 호출한다.

## 오류·재시도

클라이언트는 GET과 POST 모두 자동 재시도를 하지 않는다. 특히 POST 시간 초과·연결 유실·504·
정상 응답 파싱 실패는 이미 차감되었을 수 있어 결과를 `unknown`으로 기록한다.
새 요청 전에 계정 API 사용 내역과 처리 결과를 확인한다. 다른 모델이나 제공자로 자동 대체하지 않는다.

| HTTP/상황 | 처리 |
|---|---|
| 401 | 목적지와 키 설정 확인 |
| 402 | 잔액 또는 지출 중지 상태 확인 |
| 404 | `/api/v1/...` 경로 확인 |
| 409 | 저장된 judge를 사용하는 별도 구현에서는 최신 revision 확인 |
| 422 | 본문·모델·컨텍스트 한도 수정. 같은 입력 반복 금지 |
| 429 | `Retry-After`를 읽어 ms로 제공. 그 이전에 다시 호출하지 않음 |
| 502/503 | 확인된 실패의 재호출은 대기 후 제한적으로 수동 수행 |
| 504, 연결 유실, 응답 파싱 실패 | 처리 결과가 불확실함. 사용 내역 확인 전 POST 재전송 금지 |

오류에는 안전한 코드·HTTP 상태·재시도 대기 시간·처리 결과 상태를 남긴다. 제공자의 오류 본문,
HTTP 헤더 전체, 질문·답변 원문, 예외의 원래 cause는 로그나 CLI에 출력하지 않는다.

정상 HTTP 응답의 파싱 실패에는 `validationIssue`와 검증된 `billing`/`usage`도 기록한다.
확률 합계 오류에는 숫자 `probabilitySum`을 추가한다. 이는 처리 결과가 불확실한 상태에서
이미 차감된 비용과 검증 실패 원인을 확인하기 위한 값이며, 원본 응답을 보관하지 않는다.

## 한도·계측

- API JSON 본문 최대 256,000 **UTF-8 바이트**, 질문 1~64개, 질문 ID 최대 64자를 전송 전에 검증한다.
- Choice 선택지 2~255개, Score 기준 2~10개, Noul의 yes 확률 0~1 등 계약을 검증한다.
- 모델 자체 컨텍스트 한도는 본문 바이트 한도와 별개다. 기본 Jev의 64k/request·32k/question 한도에 맞는 짧은 입력을 사용한다. 정확한 제공자 토크나이저를 이 프로젝트에 추가하지 않았으므로 실제 컨텍스트 초과는 422로 처리하며, 입력을 몰래 자르거나 긴 컨텍스트 모드를 자동 활성화하지 않는다.
- 문서상 계정 한도는 분당 1,000회다. 비교 모드는 한 서버 요청당 추가 호출 1회이며, 분산된 서버 전체의 계정 단위 제한기는 이 초기 버전에 포함하지 않는다.
- 성공 응답에서 모델 ID, 실제 입력/출력 토큰 및 `X-Jev-*` 청구 헤더의 허용된 숫자만 읽는다. 누락 수치는 `null`이며 0으로 추정하지 않는다.
- 이 서비스는 유료 입력 토큰 우선, 부족하면 요청 전체에 모델별 크레딧을 사용한다. 서로 다른 요금제·선불·증정 크레딧 때문에 `usage.cost` 누락은 USD 비용 0이 아니다. 과거 TypeSafe 직접 사용 단가를 이 서비스 청구액으로 적용하지 않는다.
- Jev 사용량은 Bedrock 토큰 할당량에 합치지 않는다. 비교 기록은 지출 상한을 강제하지 않으므로 계정의 잔액·지출 설정을 별도로 관리한다.

## 검증 명령

```powershell
npm run typecheck
npm test -- --runInBand src/jev src/config/environment.spec.ts src/knowledge/knowledge.contract.spec.ts src/knowledge/rag-answer-contract.spec.ts
npm run build
```

자동 검증은 네트워크를 mock한다. 실제 인증 모델 조회와 유료 판단은 별도 결과로 구분한다.

## 로컬 서비스 데모 실측

2026-10-22 로컬 서비스 데모의 7개 질문 비교·비용·재시작 방법은
[로컬 비교 결과](JEV_AI_DEMO_COMPARISON_2026-10-22.md)를 참조한다.
실제 다중 판단 응답에서 모델 식별자 `typesafe-ai/jev`가 관찰되어 추가 허용했다.
이를 특정 버전으로 바꾸어 기록하지 않는다. 이후 확률 합계 경계의 부동소수점 오류를 수정하고
[실패 4문항 재검증](JEV_AI_PARSING_FIX_RETEST_2026-10-22.md)에서 4/4 정상 처리됐다.
더 많은 독립 사례의 품질 검증을 위해 shadow 관찰을 유지한다.

근거: [SDK 설정](https://jev-ai.pro/docs#official-sdk), [오류 정책](https://jev-ai.pro/docs#errors),
[TypeSafe 모델 컨텍스트 한도](https://docs.typesafe.ai/models).
