# HJ AI RAG 솔루션 외부 API 명세서

문서 버전: 1.1 · 기준일: 2026-09-12 · 대상: 솔루션 도입 서비스의 서버 개발자

이 문서는 서비스 개발에 사용하는 공개 연동 API와 소비자용 필드를 선별한 명세입니다. 연동 순서는 [개발자 매뉴얼](DEVELOPER_GUIDE.md)을 참고하세요. 예제 주소·자료·수치는 설명용입니다.

## 1. 공통 계약

### 제공 API

| 메서드 | 경로 | 용도 | 성공 상태 |
|---|---|---|---|
| POST | /knowledge/answers | 등록 지식 기반 답변 | 200 |
| POST | /knowledge/search | 관련 지식 검색 | 200 |
| POST | /bedrock/general-answers | 저위험 일반 답변 | 200 |

신규 서비스는 위 경로로 연동합니다. 지식 준비·변경은 솔루션 제공자와 합의한 절차로 진행합니다.

### 주소와 인증

BASE_URL은 제공자가 전달한 HTTPS 주소와 필요한 접두 경로를 포함합니다. 예를 들어 `https://api.example.com/ai`이면 답변 요청 주소는 `https://api.example.com/ai/knowledge/answers`입니다.

| 헤더 | 필수 | 규격 |
|---|---|---|
| appkey | 예 | 발급받은 서버 전용 키 원문. Bearer 접두어 없음 |
| Content-Type | 예 | application/json |
| x-correlation-id | 아니요 | UUID. 생략 시 서버 생성. 잘못된 값은 400 |

키는 호출 서비스의 데이터 범위와 연결됩니다. 요청 본문으로 다른 서비스의 데이터 범위를 지정하지 않습니다. 최종 사용자 인증과 권한에 맞는 키·필터 선택은 도입 서비스 서버에서 수행합니다. 키는 서버에 보관하며 브라우저 코드·모바일 앱·URL·로그에 포함하지 않습니다.

유효하지 않거나 만료된 키는 401, 비활성 서비스 등 접근이 허용되지 않는 경우는 403이 발생할 수 있습니다. 만료일과 교체 절차는 제공자에게 안내받습니다.

### 데이터 형식과 응답 범위

- 요청은 UTF-8 JSON이며 필드명은 대소문자를 구분합니다.
- 숫자·boolean은 문자열이 아닌 JSON 타입으로 보냅니다. 선택 필드는 생략합니다.
- 서버에서 정의하지 않은 요청 필드는 400으로 거절됩니다. 본 문서의 필드로 요청을 구성하세요.
- 날짜·시간은 ISO 8601 형식이며 시간대를 포함합니다.
- 응답은 단일 JSON입니다. 토큰 스트리밍과 이전 대화 자동 유지 기능은 제공 계약에 포함되지 않습니다.
- 응답 예제는 소비자용 필드만 발췌한 것으로 전체 응답을 의미하지 않습니다. 실제 응답에 부가 필드가 포함될 수 있으므로 이를 무시하고 명시한 필드만 사용합니다.
- 선택 필드의 생략과 null을 처리하고, 전체 API 응답을 고객 화면에 그대로 전달하지 않습니다.

x-correlation-id는 HTTP 응답 헤더로 반환됩니다. 답변 API의 requestId도 추적에 사용할 수 있습니다. 검색 API는 응답 헤더의 값을 사용합니다. 추적 ID는 중복 실행 방지 기능을 제공하지 않습니다.

## 2. 지식 기반 답변

`POST /knowledge/answers`

### 요청 본문

| 필드 | 타입 | 필수 | 기본값·제약 |
|---|---|---|---|
| `query` | string | 예 | 빈 문자열 불가 |
| `limit` | integer | 아니요 | 5; 1~20 |
| `scoreThreshold` | number | 아니요 | -1~1; 생략 시 검색 하한 -1, 응답에는 null |
| `filters` | object | 아니요 | 아래 검색 필터 참조 |
| `strict` | boolean | 아니요 | true; 근거가 없으면 생성 모델 미호출 |
| `includeSources` | boolean | 아니요 | true |
| `includeSourceContent` | boolean | 아니요 | false; true이면 출처 원문 일부 포함 |
| `answerStyle` | string | 아니요 | `concise`, `detailed`, `report` |
| `noAnswerMessage` | string | 아니요 | `관련 자료를 찾을 수 없어 답변할 수 없습니다.` |

고객 안내 서비스는 strict=true를 사용합니다. strict=false여도 근거 없는 답변을 허용하는 것은 아니며 답변 검증은 적용됩니다. 원문을 표시할 권한이 있는 경우에만 includeSourceContent=true를 사용하세요.

### 검색 필터: answers와 search 공통

| `filters` 내부 필드 | 타입 | 제약·동작 |
|---|---|---|
| `accessLevels` | string[] | 최대 3개; `PUBLIC`, `INTERNAL`, `RESTRICTED` |
| `businessStatuses` | string[] | 최대 3개; `DRAFT`, `PUBLISHED`, `RETIRED` |
| `productCodes` | string[] | 최대 50개; 하나 이상 일치하는 문서와 상품코드가 없는 공통 문서 포함 |
| `activeAt` | string | ISO 8601; **시작일 ≤ activeAt < 종료일**로 평가. 시작·종료일이 null이면 해당 경계 제한 없음 |

앱에 허용 공개 범위가 설정되어 있으면 요청 필터와 교집합으로 검색합니다. 요청으로 허용 범위를 확대할 수 없습니다. 필터 생략 시 `PUBLIC`, `PUBLISHED`, 현재 시각이 자동 적용되는 것은 아닙니다. 고객용 연동은 아래처럼 필터를 명시하고 앱 자체도 PUBLIC 범위로 발급받으세요. 빈 배열을 접근 차단 용도로 사용하지 마세요.

```json
{
  "query": "PRODUCT_A 설치 전에 확인할 사항을 알려주세요.",
  "strict": true,
  "includeSources": true,
  "includeSourceContent": false,
  "filters": {
    "accessLevels": ["PUBLIC"],
    "businessStatuses": ["PUBLISHED"],
    "productCodes": ["PRODUCT_A"],
    "activeAt": "2026-09-12T00:00:00.000Z"
  }
}
```

실제 호출 시 `activeAt`은 조회 기준 시각으로 갱신합니다.

### 응답

| 필드 | 타입 | 의미 |
|---|---|---|
| `query` | string | 입력 질문 |
| `answer` | string | 사용자에게 표시할 답변 |
| `answerable` | boolean | 근거 기반 답변 및 출력 검증 결과; 정확도 점수 아님 |
| `answerStatus` | string | 아래 상태값 |
| `retrieval` | object | count(검색 수, integer), limit(적용 개수, integer), scoreThreshold(요청 최소 유사도, number/null) |
| `usage` | object/null/생략 | 모델 사용량. 제공 시 inputTokens/outputTokens/totalTokens 등 |
| `latencyMs` | number | 서버 처리 측정 시간(ms) |
| `requestId` | string | HTTP 추적 ID |
| `sources` | object[]/생략 | includeSources=false면 생략; 실제 인용한 출처만 반환 |

`retrieval.count`는 검색된 청크 수이며 `sources.length`와 다를 수 있습니다. `sources[].index`는 검색 당시의 1부터 시작하는 번호를 유지하므로 연속 번호가 아닐 수 있습니다.

### 출처 필드

| sources 내부 필드 | 타입 | 사용법 |
|---|---|---|
| index | integer | 1부터 시작하는 인용 번호. 연속적이지 않을 수 있음 |
| fileId | string | 자료 식별값. 불투명한 ID로 취급 |
| fileName | string | 출처 표시명. URL이 아님 |
| score | number | 검색 유사도. 정확도·확률이 아님 |
| content | string/생략 | includeSourceContent=true일 때 최대 1,200자 발췌문 |

출처에는 추가 속성이 포함될 수 있습니다. 위 필드 중 서비스에 필요한 값만 선별하고 원본 객체를 고객에게 그대로 제공하지 않습니다.

| answerStatus | 의미 | 처리 |
|---|---|---|
| `answered` | 검증된 형식의 근거 기반 답변 | 답변과 인용 출처 표시 |
| `insufficient_evidence` | 충분한 근거 없음 | 확인 필요 안내, 담당자 문의 |
| `invalid_model_response` | 모델 출력 계약 검증 실패 | 확인 필요 안내; 추적 ID 기록 |
| `incomplete_model_response` | 모델 출력이 불완전함 | 확인 필요 안내; 추적 ID 기록 |

**HTTP 200은 답변 가능을 뜻하지 않습니다.** `answerable=false`는 정상 처리된 답변 불가 결과입니다. 이를 숨기고 일반 답변 API로 자동 전환하면 근거 없는 안내가 발생할 수 있습니다. 알 수 없는 answerStatus는 확인 필요로 처리합니다.

답변 가능한 응답 예(내용·시간·사용량은 가상 값):

```json
{
  "query": "PRODUCT_A 설치 전 확인 사항을 알려주세요.",
  "answer": "설치 안내에 따라 전원을 차단하고 구성품을 확인하세요.",
  "answerable": true,
  "answerStatus": "answered",
  "retrieval": {
    "count": 2,
    "limit": 5,
    "scoreThreshold": null
  },
  "usage": {
    "inputTokens": 800,
    "outputTokens": 80,
    "totalTokens": 880
  },
  "latencyMs": 1020,
  "requestId": "de305d54-75b4-431b-adb2-eb6b9e546014",
  "sources": [
    {
      "index": 2,
      "fileId": "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
      "fileName": "PRODUCT_A 설치 안내",
      "score": 0.8
    }
  ]
}
```

근거가 없고 strict=true인 응답 예:

```json
{
  "query": "아직 공지되지 않은 다음 버전의 출시일은 언제인가요?",
  "answer": "관련 자료를 찾을 수 없어 답변할 수 없습니다.",
  "answerable": false,
  "answerStatus": "insufficient_evidence",
  "retrieval": {
    "count": 0,
    "limit": 5,
    "scoreThreshold": null
  },
  "usage": null,
  "latencyMs": 55,
  "requestId": "de305d54-75b4-431b-adb2-eb6b9e546014",
  "sources": []
}
```

## 3. 지식 검색

POST /knowledge/search

| 요청 필드 | 타입 | 필수 | 기본값·제약 |
|---|---|---|---|
| query | string | 예 | 빈 문자열 불가 |
| limit | integer | 아니요 | 5; 1~20 |
| scoreThreshold | number | 아니요 | -1~1; 생략 시 별도 최소 유사도 제한 없이 검색 |
| filters | object | 아니요 | 2절 검색 필터와 동일 |

답변 생성용 필드는 받지 않습니다. 요청 예:

```json
{
  "query": "PRODUCT_A 설치 준비",
  "limit": 3,
  "filters": {
    "accessLevels": ["PUBLIC"],
    "businessStatuses": ["PUBLISHED"],
    "productCodes": ["PRODUCT_A"],
    "activeAt": "2026-09-12T00:00:00.000Z"
  }
}
```

| 응답 필드 | 타입 | 의미 |
|---|---|---|
| query | string | 입력 질문 |
| count | integer | 결과 수 |
| matches | object[] | 관련 지식 목록 |
| matches[].id | string | 지식 조각 식별값 |
| matches[].fileId | string | 자료 식별값 |
| matches[].fileName | string | 자료 표시명 |
| matches[].content | string | 검색된 원문 내용 |
| matches[].score | number | 검색 유사도 |

응답 예(소비자용 필드 발췌):

```json
{
  "query": "PRODUCT_A 설치 준비",
  "count": 1,
  "matches": [{
    "id": "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    "fileId": "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
    "fileName": "PRODUCT_A 설치 안내",
    "content": "설치 전 전원을 차단하고 구성품을 확인하세요.",
    "score": 0.8
  }]
}
```

결과가 없으면 HTTP 200, count=0, matches=[]입니다. 원문을 반환하므로 최종 사용자 권한을 확인하고 표시 범위를 결정하세요. 점수는 유사도이며 사실 정확도·확률이 아닙니다. 추적 ID는 x-correlation-id 응답 헤더에서 읽습니다.

## 4. 저위험 일반 답변

POST /bedrock/general-answers

인사·감사·안정적인 기본 상식 질문에 사용합니다. 제품 정책이나 등록 지식의 사실 확인을 대체하지 않습니다.

| 요청 필드 | 타입 | 필수 | 제약 |
|---|---|---|---|
| query | string | 예 | 빈 문자열 불가, 최대 2,000자 |

```json
{ "query": "클라우드 컴퓨팅이 무엇인가요?" }
```

| 응답 필드 | 타입 | 의미 |
|---|---|---|
| query | string | 입력 질문 |
| answer | string | 답변 또는 확인 필요 안내 |
| generalAnswerEligible | boolean | 일반 답변으로 제공 가능한지 판정 |
| reviewRecommended | boolean | 담당자 확인 권장 여부 |
| reviewReasons | string[] | 현재 PROVIDER_REVIEW_RECOMMENDED 또는 빈 배열 |
| usage | object/null | 제공 가능한 토큰 사용량 |
| latencyMs | number | 서버 처리 측정 시간(ms) |
| requestId | string | 추적 ID |

응답 예(소비자용 필드 발췌):

```json
{
  "query": "클라우드 컴퓨팅이 무엇인가요?",
  "answer": "인터넷을 통해 필요한 컴퓨팅 자원을 이용하는 방식입니다.",
  "generalAnswerEligible": true,
  "reviewRecommended": false,
  "reviewReasons": [],
  "usage": { "inputTokens": 100, "outputTokens": 30, "totalTokens": 130 },
  "latencyMs": 500,
  "requestId": "de305d54-75b4-431b-adb2-eb6b9e546014"
}
```

generalAnswerEligible=false 또는 reviewRecommended=true이면 확인 필요로 처리합니다. 판정은 사실 정확도를 보증하지 않습니다. 지식 기반 답변에서 근거가 없다는 이유로 자동 호출하지 마세요.

## 5. 공통 오류와 재시도

```json
{
  "statusCode": 400,
  "message": ["query should not be empty"],
  "error": "Bad Request",
  "code": "VALIDATION_ERROR",
  "requestId": "de305d54-75b4-431b-adb2-eb6b9e546014"
}
```

statusCode는 정수, message는 string 또는 string[], error·code·requestId는 string입니다. message·error의 문구에 의존하지 말고 HTTP 상태와 code로 처리합니다.

| HTTP | 기본 code | 처리 |
|---|---|---|
| 400 | VALIDATION_ERROR | 필드·타입·UUID 수정 |
| 401 | AUTHENTICATION_REQUIRED | 키 누락·만료·교체 확인 |
| 403 | ACCESS_DENIED | 서비스 상태·허용 범위 확인 |
| 404 | NOT_FOUND | 제공받은 기본 주소·경로 확인 |
| 429 | RATE_LIMITED | 일시 부하·사용 한도 확인, 제한적 재시도 |
| 500 및 매핑 없는 5xx | INTERNAL_ERROR | 추적 ID 기록, 제한적 재시도 또는 문의 |

명시적인 code가 반환되면 기본 매핑보다 우선합니다. 알 수 없는 code는 HTTP 상태도 확인하세요. 네트워크·프록시 장애는 비JSON 응답이나 응답 없음으로 발생할 수 있습니다.

입력·인증 오류는 같은 요청을 반복하지 않습니다. 일시적 연결 실패·429·5xx에는 제한된 횟수로 간격을 늘려 재시도할 수 있습니다. HTTP 200의 답변 불가 결과를 통신 오류로 재시도하지 마세요. 생성은 응답이 유실되어도 실행되었을 수 있고, 추적 ID를 재사용해도 중복 실행·사용량은 방지되지 않습니다. 응답 시간·이용 한도는 제공자와 합의한 조건을 따릅니다.

## 6. 서버 연동 예제

아래는 Node.js의 fetch를 사용하는 앱 서버 예제입니다. 새 의존성은 필요하지 않습니다. AI_API_BASE_URL은 담당자가 제공한 접두 경로 포함 주소, AI_APPKEY는 비밀 저장소에서 주입합니다. 예제는 자동 재시도를 수행하지 않습니다.

```javascript
import { randomUUID } from 'node:crypto';

export async function askKnowledge(query) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('질문을 입력하세요.');
  const baseUrl = process.env.AI_API_BASE_URL;
  const appkey = process.env.AI_APPKEY;
  if (!baseUrl || !appkey) throw new Error('AI 연동 설정이 필요합니다.');
  const sentRequestId = randomUUID();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/knowledge/answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      appkey,
      'x-correlation-id': sentRequestId,
    },
    signal: AbortSignal.timeout(60000), // 예제 값. 운영 응답 시간·프록시에 맞춰 조정
    body: JSON.stringify({
      query: query.trim(),
      strict: true,
      includeSources: true,
      includeSourceContent: false,
      filters: {
        accessLevels: ['PUBLIC'],
        businessStatuses: ['PUBLISHED'],
        activeAt: new Date().toISOString(),
      },
    }),
  });
  const requestId = response.headers.get('x-correlation-id') ?? sentRequestId;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    // 인증키·질문 원문·전체 응답을 로그로 출력하지 않습니다.
    throw new Error(`AI HTTP ${response.status}; code=${data?.code ?? 'NON_JSON'}; id=${requestId}`);
  }
  if (typeof data.answer !== 'string' || typeof data.answerable !== 'boolean') {
    throw new Error(`AI 응답 형식 확인 필요; id=${requestId}`);
  }
  const answered = data.answerable === true && data.answerStatus === 'answered';
  return {
    answer: answered ? data.answer : '등록된 자료로 확인하기 어렵습니다. 담당자에게 문의해 주세요.',
    needsReview: !answered,
    sources: answered && Array.isArray(data.sources)
      ? data.sources
          .filter((source) => source && Number.isInteger(source.index) && typeof source.fileName === 'string')
          .map(({ index, fileName }) => ({ index, fileName }))
      : [],
    requestId: data.requestId ?? requestId,
  };
}
```

호출부는 네트워크 오류·AbortError/TimeoutError도 처리하고, needsReview=true인 결과를 확정 답변으로 표시하지 않습니다. 실제 고객 화면에 연결할 때 사용자 인증, 조직 매핑과 요청 빈도 제한을 앱 서버에 적용하세요.

응답의 추가 속성을 그대로 고객에게 전달하지 않습니다. 여러 조직을 지원하는 서비스는 인증된 조직에 맞는 키를 선택한 뒤 호출하세요.
