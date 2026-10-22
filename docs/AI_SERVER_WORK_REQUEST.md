# HJ AI Server 작업 요청서 — 고객문의 프로토타입 연동

- 작성일: 2026-10-22
- 요청 프로젝트: `customer-service`
- 대상 프로젝트: `HJ_AI_Server`
- 상태: REQ-01/02 구현·자동 검증 및 2026-10-22 운영 코드 배포 완료. 운영 Jev 모드는 off이며 SET-01/02와 VAL-01은 미완료다. 코드 배포와 실제 분류 활성화를 구분한다.
- 목적: 고객문의 프로토타입이 기존 AI API를 호출하고 Jev 분류, AWS 답변, 근거와 실행 정보를 비교·평가할 수 있도록 한다.
- 범위: AI 서버 변경과 연동 환경 준비. 고객서비스 프런트·백엔드 구현은 별도 작업이다.
- 관련 문서: customer-service 프로젝트의 `PROTOTYPE_SYSTEM_DESIGN.md`. 현재 저장소에는 사본이 없으며 원본의 정확한 경로·접근 링크는 인수 시 확인한다.

## 1. 현재 구현과 유지할 동작

로컬 소스 기준 다음 기능은 구현되어 있으므로 재구현하지 않는다.

1. `POST /knowledge/answers`에서 Jev 선분류 → 기존 검색 → AWS Bedrock 생성 → 근거·출력 검증을 수행한다.
2. `classify` 모드에서 범용 8개 유형을 사용한다. confidence와 선택 확률이 모두 0.7 이상이어야 선택 유형을 적용하고, 낮으면 `other` 지침을 적용한다.
3. Jev 실패 시 기존 RAG로 진행한다. 분류는 검색 범위·접근 권한을 변경하지 않는다.
4. strict 모드에서 검색 및 보조 근거가 없으면 Bedrock 생성을 생략한다.
5. Jev 결과는 `knowledge_query_log.execution.jevClassification`에 기록한다. 기존 공개 답변과 Console 로그 응답에는 분류 상세가 없었다. REQ-01/02는 공개 답변의 선택적 요약과 내부 실행 로그만 확장하며 Console 로그 API는 변경하지 않는다.
6. `classify`에서는 생성 후 shadow 평가를 중복 호출하지 않는다.

최초 작성 시 운영 배포 상태는 확인하지 않았다. 후속 배포에서 `https://ai.hjshub.com`의 최신 코드 반영을 확인했다. [배포 및 실검증 기록](HJ_AI_CONSOLE_QUOTA_DEPLOYMENT_2026-10-22.md)의 최신 변경 대조 결과를 따른다.

## 2. 필수 변경 및 준비

| ID | 구분 | 요청 내용 | 완료 조건 |
|---|---|---|---|
| REQ-01 | 코드 | 답변 API에 선택적 분류 요약 반환 | 3절 계약과 성공/저신뢰/실패/미실행 테스트 통과 |
| REQ-02 | 코드·문서 | 실행 기록과 응답의 분류 상태·정책 버전 일치, Swagger 규격 반영 | 응답과 로그를 동일 requestId로 추적 가능 |
| SET-01 | 설정 | 고객문의 전용 앱, appkey, classify 허용 앱 등록 | 전용 앱에서 실제 분류 후 생성 확인 |
| SET-02 | 설정·자료 | 기본 모델·상담 지침, 검수 지식의 검색 범위·게시 정책 설정 | 주차장 간 혼입 및 미게시 지식 노출 테스트 통과 |
| VAL-01 | 검증 | 실제 대표 문의의 연동 검증과 인수 자료 제공 | mock과 실측 결과를 구분해 보고 |

REQ-01은 고객서비스가 AI 서버 DB나 Console 인증에 직접 의존하지 않게 하기 위한 변경이다.
REQ-02를 위해 Console 로그 API의 공개 범위를 넓힐 필요는 없다. 기존 실행 로그를 유지하면서 요약 투영 로직을 공유한다.
SET-01/02는 새 핵심 엔진 개발이 아닌 환경 설정·자료 준비 작업이다.

## 3. 답변 생성 API 계약

### 3.1 경로와 인증

```http
POST {AI_BASE_URL}{API_GLOBAL_PREFIX}/knowledge/answers
Content-Type: application/json
appkey: <고객문의 앱의 서버 전용 키>
x-correlation-id: <요청마다 생성하는 UUID>
```

`AI_BASE_URL`은 origin이며 `API_GLOBAL_PREFIX`는 설정된 경우에만 한 번 붙인다.
인증으로 결정된 앱 범위를 사용한다. 요청 본문에서 appcode/appId를 임의 지정하지 않는다.
appkey는 customer-service 백엔드에만 보관한다.

### 3.2 요청 예시

```json
{
  "query": "주차장: 데모 A 주차장\n상품: 입주자 정기권\n문의: 정기권 환불은 어디에서 신청하나요?",
  "strict": true,
  "includeSources": true,
  "includeSourceContent": true,
  "includeClassification": true,
  "answerStyle": "concise",
  "limit": 5,
  "filters": {
    "businessStatuses": ["PUBLISHED"],
    "productCodes": ["PARK_A_RESIDENT_PASS"],
    "activeAt": "2026-10-22T03:00:00.000Z"
  }
}
```

예시의 주차장·상품·시각·범위코드는 설명용이며 실제 등록 값으로 치환한다.

| 필드 | 규격 | 비고 |
|---|---|---|
| query | 필수 string, 비어 있지 않음 | 주차장·상품·문의의 정제된 텍스트 |
| includeClassification | 신규 optional boolean, 기본 false | 요약 반환 여부만 제어. Jev 실행 여부·모드·권한을 바꾸지 않음 |
| strict | 기존 boolean | 고객서비스는 true로 고정 |
| includeSources / includeSourceContent | 기존 boolean | 검토 화면용 근거를 받되 고객 공개 필드는 BFF가 제한 |
| answerStyle | 기존 concise/detailed/report | 초기 concise |
| limit | 기존 integer 1~20 | 초기 5, 검색 임계값은 실측 후 조정 |
| filters | 기존 KnowledgeSearchFiltersDto | 게시 상태·범위코드·시각을 백엔드에서 결정 |

새 boolean은 JSON true/false만 허용하고 `"false"` 등 문자열을 true로 변환하지 않는다.
신규 DTO 필드를 whitelist와 Swagger에 등록한다. false/생략이면 기존 응답 형태를 유지한다.
`includeClassification=true`도 off/shadow/비허용 앱의 Jev 호출을 새로 유발하지 않는다.
기존 modelId/system/supplementalSources 계약은 변경하지 않는다. 고객서비스는 브라우저에서 해당 값을 받지 않는다.

### 3.3 정상 응답

기존 `answer`, `response`, `answerable`, `answerStatus`, `sources`, `usage`, `performance`, `requestId` 등의 의미와 타입을 유지한다.
아래는 **신규 필드와 연결 키만 발췌한 설명용 예시**이며 전체 응답이 아니다.

```json
{
  "requestId": "b76ec57f-9026-4e02-8ec0-43a9fb6e58a2",
  "classification": {
    "status": "classified",
    "category": "refund_exchange",
    "appliedCategory": "refund_exchange",
    "applied": true,
    "confidence": 0.93,
    "selectedProbability": 0.91,
    "minimumConfidence": 0.7,
    "policyVersion": "inquiry-v1",
    "durationMs": 820,
    "reason": null,
    "errorCode": null,
    "outcome": "succeeded",
    "usage": { "inputTokens": 180, "outputTokens": 35 },
    "billing": { "creditsCharged": 1, "paidInputTokensUsed": 0 }
  }
}
```

`classification`는 includeClassification=true인 HTTP 200 답변에 필수로 포함한다.
객체 안의 아래 필드는 모두 존재하되 정의에 따라 null을 허용한다.

| 필드 | 타입·규칙 |
|---|---|
| status | `classified` / `unavailable` / `skipped` |
| category | 원래 선택 유형 string 또는 null. 현재 8개 enum, 후속 정책 확장 시 version과 함께 변경 |
| appliedCategory | 적용한 지침 유형 string 또는 null |
| applied | boolean. 원래 선택 유형이 임계값을 통과해 적용되었는지 |
| confidence | number 0~1 또는 null. 답변 정확도나 보정된 정답 확률이 아님 |
| selectedProbability | 원래 선택 유형의 확률 number 0~1 또는 null |
| minimumConfidence | 현재 적용 임계값 number 0~1 또는 null |
| policyVersion | 시도한 분류 정책 버전 string 또는 null |
| durationMs | 측정한 분류 경과 ms, 0 이상 number 또는 null |
| reason | null / `low_confidence` / `classification_unavailable` / `not_enabled_for_request` / `request_cancelled` |
| errorCode | null / `CLASSIFICATION_UNAVAILABLE` / `CLASSIFICATION_INVALID_RESPONSE` |
| outcome | `succeeded` / `not_sent` / `failed` / `unknown` |
| usage | null 또는 {inputTokens: integer>=0, outputTokens: integer>=0}. 검증된 값만 반환 |
| billing | {creditsCharged: number>=0 또는 null, paidInputTokensUsed: number>=0 또는 null} |

현재 category enum: product, refund_exchange, shipping_order, billing_payment,
technical_support, store_info, complaint, other.

누락 사용량·청구량을 0으로 추정하지 않는다. 계정 잔액, 제공자 원본, destination,
인증정보, 질문 재인용, 전체 probabilities/answers 객체는 반환하지 않는다.
통화가 명확하지 않은 provider cost는 이번 계약에서 제외한다.
기존 최상위 usage는 Bedrock 생성 사용량으로 유지하고 Jev와 합산하지 않는다.

### 3.4 상태별 의미

| 상황 | status | category / appliedCategory | applied | reason / outcome |
|---|---|---|---|---|
| confidence와 선택 확률 모두 0.7 이상 | classified | 원래 유형 / 동일 유형 | true | null / succeeded |
| 둘 중 하나라도 0.7 미만 | classified | 원래 유형 / other | false | low_confidence / succeeded |
| other를 높은 확신도로 선택 | classified | other / other | true | null / succeeded |
| API 오류·시간 초과·파싱 실패 | unavailable | null / null | false | classification_unavailable / 기존 클라이언트 outcome |
| off/shadow/앱 미허용/원문 외부전송 금지 등 | skipped | null / null | false | not_enabled_for_request / not_sent |
| 호출 전 취소 | skipped | null / null | false | request_cancelled / not_sent |

- 호출 전 취소와 비활성 조건이 동시에 성립하면 `request_cancelled`를 우선한다. 호출 이후 취소는 기존 클라이언트의 실패 outcome을 보존한다.
- skipped: confidence, selectedProbability, minimumConfidence, policyVersion, durationMs, usage는 null; billing의 값도 null; errorCode=null.
- unavailable: confidence/selectedProbability는 null. 시도한 policyVersion과 threshold는 기록하고 측정 durationMs를 반환한다. 검증된 청구·사용량이 있으면 실패해도 보존한다.
- unavailable의 provider 응답 검증 실패는 CLASSIFICATION_INVALID_RESPONSE, 그 외는 CLASSIFICATION_UNAVAILABLE로 투영한다. 상세 내부 코드는 서버 로그에 유지한다.
- 낮은 확신도는 실패가 아니다. other 지침을 적용한 성공적인 분류 응답으로 집계한다.
- 취소 시 실제 HTTP 응답을 보낼 수 없는 경우 위 상태는 기록용이다. 취소된 연결에 200 응답을 보장하지 않는다.

### 3.5 답변 상태·HTTP 오류와의 관계

- Jev 실패 후 RAG 성공: HTTP 200, classification.status=unavailable, answerStatus는 실제 RAG 결과.
- strict 무근거: HTTP 200, answerable=false, answerStatus=insufficient_evidence. 이미 수행된 분류 요약도 반환한다.
- invalid_model_response / incomplete_model_response에서도 HTTP 200을 반환하는 기존 분기는 분류 요약을 누락하지 않는다.
- appkey 오류, 잘못된 요청, 제한 초과, Bedrock 예외 등 비-200 처리 및 공통 오류 형식은 기존 계약을 유지한다.
- 비-200 응답에는 classification을 추가하도록 요구하지 않는다. 수행된 분류와 실패 단계는 기존 로그에 기록한다.
- 인증·DTO 검증·한도 검사에서 거절된 요청이 신규 플래그 때문에 Jev를 호출하지 않아야 한다.
- requestId는 응답/기록/추적 헤더와 일치한다. 동일 ID가 생성 API의 멱등성을 보장한다는 의미는 아니다.
- POST 자동 재시도를 추가하지 않는다. 시간 초과·파싱 실패 후 결과 불명확 상태를 보존한다.

### 3.6 구현 위치와 호환성

주요 변경 후보:

- `src/knowledge/dto/knowledge-rag-response.dto.ts`: includeClassification.
- `src/knowledge/entities/knowledge-answer.entity.ts`: 분류 요약 DTO 및 응답 문서.
- `src/jev/jev.service.ts`: 실행·미실행 상태 정규화에 필요한 내부 결과.
- `src/knowledge/knowledge.service.ts`: 안전한 요약 투영, 정상/무근거 등 모든 200 분기 반영.
- 관련 Jest 계약 테스트와 연동 문서.

기존 클라이언트가 opt-in하지 않으면 신규 응답 필드를 내보내지 않는다.
동일 DTO·서비스를 공유하는 `/knowledge/rag-response`에도 같은 선택적 계약을 적용해 일관성을 유지한다.
원본 결과를 spread하는 대신 허용 필드를 명시적으로 구성한다.
새 DB 컬럼은 필수 요건이 아니다. 기존 execution JSON을 사용하되 과거 로그를 현재 값으로 추정하지 않는다.
실행 시 `execution.classification`에 공개 요약과 같은 투영 결과를 저장하고 `execution.jevClassification`의 내부 결과는 유지한다. 이 기록은 응답 opt-in 여부와 무관하다. 단, 원문 기록 금지 앱의 기존 execution 제거 정책을 우선하며 해당 앱의 로그 일치 검증은 이 제한을 명시한다.

## 4. 필수 환경·지식 연동 규격

### 4.1 전용 앱 설정

- 정확한 appId/appcode를 발급하고 고객문의 앱을 JEV_AI_RAG_APPCODES에 등록한다.
- 고객문의 전용 검증 인스턴스에서 JEV_AI_RAG_MODE=classify를 사용하고 허용 앱은 고객문의 앱으로 한정한다. 기존 Jev credential과 AWS 설정은 보안 전달 절차로 제공한다. 현재 모드는 전역 설정이므로 기존 공용 인스턴스의 모드를 변경하지 않는다. 전용 인스턴스가 준비되지 않으면 SET-01 완료로 처리하지 않는다.
- 기본 생성/임베딩 모델, allowedAccessLevels, 사용량 한도와 주차 상담 systemPrompt를 설정한다.
- 지침은 자료에 근거한 안내, 주차장별 조건 구분, 미수행 승인·결제·환불 완료 주장 금지를 포함한다.
- 검증 환경을 먼저 준비한다. 운영 설정 변경·배포는 본 요청서 작성으로 실행된 것으로 간주하지 않는다.

### 4.2 지식 등록 — 기존 API 재사용

```http
POST {AI_BASE_URL}{API_GLOBAL_PREFIX}/admin/v1/knowledge/apps/{appId}/texts
Content-Type: application/json
x-admin-key: <지식 운영 credential>
```

```json
{
  "originalName": "parking-a-resident-refund.md",
  "content": "검수자가 확인한 주차장 A 입주자 정기권 환불 절차 본문",
  "metadata": { "sourceRecordId": "cs-knowledge-001", "sourceVersion": "1" },
  "accessLevel": "PUBLIC",
  "businessStatus": "DRAFT",
  "productCodes": ["PARK_A_RESIDENT_PASS"]
}
```

본문은 설명용 자리표시자이며 실제 운영 지식으로 등록하지 않는다.
응답은 기존 KnowledgeFileEntity 계약을 유지한다. 반환된 문서 ID를 customer-service에서 저장한다.
텍스트 등록은 기존 동기 등록·색인 동작을 사용한다. 검수 및 색인 확인 후 다음 기존 API로 게시한다.

```http
PATCH {AI_BASE_URL}{API_GLOBAL_PREFIX}/admin/v1/knowledge/apps/{appId}/files/{id}/policy
Content-Type: application/json
x-admin-key: <지식 운영 credential>
```

```json
{ "businessStatus": "PUBLISHED" }
```

파일 업로드가 필요한 경우 기존 files → index-jobs → index-jobs/{jobId} 경로를 사용한다.
관리자 credential은 초기 적재 작업에만 사용하고 상담 요청 프로세스와 브라우저에 배포하지 않는다.

### 4.3 검색 범위 규약

- 기존 productCodes는 빈 코드 문서를 공통 자료로 포함하고, 값이 있는 문서는 하나 이상 일치하면 포함한다.
- 초기에는 주차장·상품 조합별 불변 코드 하나를 사용한다. 주차장 코드와 상품 코드를 별도 OR 조건으로 넣지 않는다.
- 주차장 공통 문서는 해당 주차장의 상품 범위코드들을 부여하고 전체 공통 안내만 빈 코드를 사용한다.
- 주차장·상품 미확인 시 customer-service에서 추가 입력을 요구한다. 범위 필터를 생략해 전체 검색하지 않는다.
- PUBLISHED와 activeAt을 상담 백엔드에서 지정한다. 임의 metadata는 검색 필터가 아니다.
- 지식 범위 규약은 검색 정확도를 위한 것이며 앱 인증·자료 접근 권한을 대체하지 않는다.

## 5. 후속 개선 — 초기 연동의 선행 조건 아님

| ID | 개선 | 제안 범위와 검증 |
|---|---|---|
| IMP-01 | 앱별 주차 전용 분류 | 기존 inquiry-v1을 유지하고 parking-inquiry-v1 등 별도 정책을 앱 설정으로 선택. 엑셀 13개 카테고리를 자동 정답으로 간주하지 않고 대표 문의 검수 후 확정 |
| IMP-02 | 대응 방식 판단 | category와 별개로 guidance / needs_information / needs_operator를 판단. 실제 업무 상태나 권한을 분류 결과로 추정하지 않음 |
| IMP-03 | 주차장·상품 독립 필터 | parkingLotIds와 productCodes를 교차 조건으로 처리하는 새 계약. 공통 지식의 포함 규칙·빈 값·미지정 동작·마이그레이션 정의 후 적용 |
| IMP-04 | 앱별 분류 모드 및 비교 실행 | 현재 전역 off/shadow/classify를 앱별로 선택. 고객 입력으로 임의 변경하지 않으며 실험 간 지식·모델·정책 조건 고정 |
| IMP-05 | 요청 상태 조회 | 인증된 앱 범위로 requestId 실행 결과를 조회해 시간 초과 결과 확인 지원. 필요하면 멱등 실행 계약을 별도 설계 |

IMP-02의 응답 후보(미확정): `classification.handling = { decision, confidence }`.
최종 고객 응답 상태와는 별개이며 카테고리·대응 방식·근거 충분성을 각각 검증한다.
후속 개선을 필수 변경에 묶어 초기 통합을 지연하지 않는다.

## 6. 검증 및 인수 기준

### 자동 테스트 필수 사례

1. includeClassification 생략/false: 기존 응답 유지. true: 요약 반환. 문자열 boolean 거절.
2. 정상 분류, confidence만 낮음, 선택 확률만 낮음, 0.7 경계, 높은 확신도의 other.
3. Jev 장애/시간 초과/파싱 실패 후 기존 RAG 유지. 실패 청구 값이 있으면 보존.
4. off/shadow/비허용 앱/전송 금지 앱: 플래그로 인한 추가 분류 호출 없음, skipped 상태, 외부전송 제한 유지. shadow 모드의 기존 생성 후 평가 호출은 유지하며 전체 Jev 호출 수가 0이라고 단정하지 않는다.
5. strict 무근거: Bedrock 생성 없음, 이미 수행한 분류 결과는 반환.
6. 불완전/잘못된 생성 응답: 기존 answerStatus 유지, 분류 요약 포함.
7. 정상·실패 로그의 requestId와 정책·분류 결과 일치. Bedrock 사용량 불변.
8. 키·계정 잔액·제공자 원문·전체 결과 객체가 신규 필드에 노출되지 않음.
9. classify에서 Jev 한 번만 호출하고 shadow 중복 및 자동 재전송 없음.
10. 다른 주차장/상품, DRAFT/RETIRED, 적용 기간 밖의 자료가 지정 범위에 섞이지 않음.

권장 실행 명령(최종 변경 파일에 맞게 조정):

```text
npm run test:ci -- --runTestsByPath src/jev/jev.service.spec.ts src/knowledge/knowledge.contract.spec.ts src/config/environment.spec.ts src/jev/jev-classification-summary.spec.ts src/knowledge/knowledge-classification-http.spec.ts
npm run typecheck
npm run build
```

신규 DTO 및 직렬화 테스트를 위 대상에 추가한다. 실패 시 프로젝트 지침의 디버깅 횟수 제한을 준수한다.

### 실제 연동 검증

고객문의용 비식별·검수 표본으로 정상 안내, 환불 절차, 추가정보 필요, 담당자 처리,
근거 부족, 주차장 혼입 방지 사례를 확인한다. 각 건에 requestId·분류·답변·근거·시간·사용량을 남긴다.
Jev 성공 뒤 최종 답변이 부적합한 사례와 Jev 실패 뒤 RAG가 적합한 사례를 분리한다.
합성 자료 테스트를 실제 엑셀 문의 적합성 검증으로 보고하지 않는다.

### 대상 프로젝트가 전달할 인수 자료

- 반영 커밋/배포 버전, 수정 파일, 미완료 항목.
- 실제 base URL/prefix, appId/appcode, 활성 정책 버전, 인증키 전달 방법(키 본문은 문서·채팅에 기록하지 않음).
- 갱신된 OpenAPI와 성공/저신뢰/실패/미실행/무근거 응답 예시.
- 테스트 명령·결과, 실제 호출 여부·표본·비용·제약.
- 지식 파일 ID·게시/색인 상태·범위코드 목록 및 알려진 제한.

## 7. 작업 경계

이 문서는 HJ AI Server 프로젝트에 전달할 요청서다. customer-service 프로젝트의 작업에서는 서버 소스 수정·설정 변경·배포를 수행하지 않는다. 현재 HJ_AI_Server 작업에서는 사용자가 승인한 REQ-01/02 구현·자동 테스트와 요청서 보완만 수행하며 환경 설정과 운영 배포는 포함하지 않는다.
고객서비스의 사용자 관리, 문의 DB, 화면, 평가 저장은 customer-service가 담당한다.
AI 서버의 기존 매장 데모 및 다른 앱 정책을 전역 변경하지 않는다.
기존 기능을 재사용하고 신규 의존성·DB 구조 확대가 필요한 경우 이유와 범위를 먼저 정리한다.

## 8. 검토 근거 파일

대상 저장소 `C:\Work\HJSolution\HJ_AI_Server` 기준:

- `src/jev/jev.service.ts`, `src/jev/jev-inquiry-policy.ts`, `src/jev/jev-client.ts`
- `src/knowledge/knowledge.controller.ts`, `src/knowledge/knowledge-admin.controller.ts`
- `src/knowledge/knowledge.service.ts`, `src/knowledge/entities/knowledge-answer.entity.ts`
- `src/knowledge/dto/knowledge-rag-response.dto.ts`, `src/knowledge/dto/knowledge-policy.dto.ts`
- `src/console/request-logs/console-request-logs.service.ts`

문서 작성 시 신규 API를 실행하거나 코드 테스트를 재실행하지 않았다.


## 9. REQ-01/02 구현·검증 기록 (2026-10-22)

### 반영 내용

- `includeClassification`은 생략/false 시 응답 필드를 추가하지 않는다. JSON boolean만 허용하며 문자열, 숫자, 객체, 배열 및 null은 400으로 거절한다.
- `/knowledge/answers`와 `/knowledge/rag-response`에 같은 선택적 요약과 Swagger 응답 스키마를 적용했다.
- `src/jev/jev-classification-summary.ts`에서 허용 필드만 구성한다. 계정 잔액, destination, provider 원문, 전체 answers/probabilities, cost는 제외한다.
- 미실행·호출 전 취소를 내부 상태로 구분하고 실패에도 시도한 정책 버전·임계값을 유지한다. 호출 전 취소를 우선한다.
- `execution.classification`과 공개 응답에 같은 요약을 사용한다. 정상·무근거·생성 출력 검증 실패 및 생성 예외 로그에 적용되며 `execution.jevClassification`도 유지한다.
- 원문 기록 금지 앱은 기존 정책대로 execution 자체를 저장하지 않는다. 과거 로그 보정이나 Console 로그 API 확장은 하지 않았다.
- 신규 의존성, DB 스키마 변경, 전역 Jev 모드 변경, 자동 재전송은 추가하지 않았다.

### 응답 예시 해석

3.3의 정상 예시는 그대로 적용된다. 아래는 동일한 전체 요약 스키마에서 달라지는 값이다.

| 사례 | 핵심 값 |
|---|---|
| 저신뢰 | status=classified, category=product, appliedCategory=other, applied=false, confidence=0.6, selectedProbability=0.9, reason=low_confidence, outcome=succeeded |
| 파싱 실패 | status=unavailable, category/appliedCategory/confidence/selectedProbability=null, applied=false, minimumConfidence=0.7, policyVersion=inquiry-v1, reason=classification_unavailable, errorCode=CLASSIFICATION_INVALID_RESPONSE, outcome=unknown |
| 미실행 | status=skipped, applied=false, reason=not_enabled_for_request, outcome=not_sent. category/appliedCategory/confidence/selectedProbability/minimumConfidence/policyVersion/durationMs/usage/errorCode와 billing의 두 값은 null |
| strict 무근거 | answerable=false, answerStatus=insufficient_evidence, 최상위 usage=null. classification은 이미 수행된 분류 또는 미실행 요약이며 Bedrock은 호출하지 않음 |

실패의 durationMs는 실측 경과 시간이다. 실패 usage/billing은 검증된 제공자 값이 있는 경우만 보존하고 없으면 null이다. 예시 숫자는 운영 실측치가 아니다.

### 자동 검증

```text
npm run test:ci -- --runTestsByPath src/jev/jev.service.spec.ts src/jev/jev-classification-summary.spec.ts src/knowledge/knowledge.contract.spec.ts src/knowledge/knowledge-classification-http.spec.ts src/config/environment.spec.ts src/jev/jev-client.spec.ts
npm run typecheck
npm run build
npx --no-install eslint src/jev/jev.service.ts src/jev/jev.service.spec.ts src/jev/jev-classification-summary.ts src/jev/jev-classification-summary.spec.ts src/knowledge/knowledge.service.ts src/knowledge/knowledge.contract.spec.ts src/knowledge/knowledge.controller.ts src/knowledge/knowledge-classification-http.spec.ts src/knowledge/entities/knowledge-answer.entity.ts src/knowledge/dto/knowledge-rag-response.dto.ts
```

- Jest: 6개 스위트, 139개 테스트 Pass. 정상/저신뢰/0.7 경계/other, 실패 비용 보존, 비활성·비허용·전송 제한·취소, 기존 shadow/classify 동작, 무근거·잘못된/불완전한 출력·생성 예외의 기록을 확인했다.
- 실제 Nest HTTP 파이프라인에서 두 경로의 DTO 검증, 인증 누락 거절, correlation ID 전달 및 OpenAPI 스키마를 확인했다. 이 테스트의 서비스·앱 조회는 mock이며 외부 AI/DB 연동 검증이 아니다.
- typecheck, build, 변경 TypeScript 10개 파일 ESLint: Pass.
- 첫 자동 검증에서는 HTTP fixture의 앱 상태 대소문자, 기존 부분 mock, 반환 타입 추론 문제가 발견되어 수정했다. 이후 테스트 타입·린트 문제를 수정하고 재검증했다.
- 기존 작업 변경이 있는 작업 트리에서 검증했다. 이번 작업으로 커밋하거나 배포하지 않았다.

### 남은 범위

SET-01/02 및 VAL-01은 미착수다. 실제 Jev/Bedrock/DB 호출, 전용 인스턴스 준비, 지식 적재·게시, 실제 주차장 혼입 검증, 대표 문의 적합성, 운영 배포는 실행하지 않았다. 따라서 6절 전체 인수 완료나 운영 준비 완료를 의미하지 않는다.
