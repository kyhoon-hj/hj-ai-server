# Console 사용량·요청 로그 계약 (M2)

작성일: 2026-09-18. 대상: HJ_AI_Server Console API/Web.

기준: [마일스톤](HJ_AI_CONSOLE_MILESTONES.md), [월 한도 정책](HJ_AI_CONSOLE_QUOTA_POLICY.md),
[예약 복구 절차](HJ_AI_CONSOLE_USAGE_RECOVERY_RUNBOOK.md).

## 1. 기록 대상과 결과

사용량의 요청은 생성 서비스가 요청 admission을 통과한 실행이다. 인증·DTO·모델 설정·capability
검사나 요청 admission에서 거절된 HTTP 요청은 포함하지 않는다. 승인 후 토큰 admission,
검색, 생성, 응답 검증 실패는 실패 요청으로 기록한다. SDK 내부 재시도와 대화 replay는 추가 요청이 아니다.

| 경로 | 저장소 | Console endpoint |
| --- | --- | --- |
| Bedrock converse / text-response / general-answers | bedrock_search_log | 각 `/bedrock/*` 경로 |
| 지식 answers / rag-response 별칭 | knowledge_query_log | `/knowledge/answers` (canonical) |
| Family v1/v2 대화 | bedrock_search_log | `/conversation/v1/turns` |
| Family RAG 대화 | family_conversation_metric | `/conversation/v1/turns` |
| 원본 로그 유실 후 CONFIRM_USAGE 복구 | console_usage_reservation | operation scope에서 알 수 있는 경로, 없으면 `unknown` |

공통 응답 필드: `id`(source:UUID), `requestId`, `endpoint`, `status`, `result`, `errorCode`,
`failureStage`, `modelId`, `latencyMs`, `tokens`, `occurredAt`, `originalAt`, `reservationId`,
`recovered`, `tokenSource`. 요청 ID는 Bedrock/지식의 correlation ID(없으면 UUID), 대화의
DTO requestId다. 과거·유실된 ID는 임의로 생성하지 않고 null을 유지한다.

`status`는 success/failed/unknown이다. 지식의 insufficient_evidence와 정상 차단 답변은
정상 응답이므로 success다. Family의 응답 유효성·근거 최신성 검사 실패는 failed다.
원문 예외 대신 안전한 운영 오류 코드만 저장한다. Console 목록·상세·CSV는 질문·답변을 노출하지 않는다.
Family는 원문 저장도 하지 않는다.

로그 INSERT 실패는 다른 실패 로그를 추가하여 덮지 않는다. 연결 가능한 예약은 UNCERTAIN으로
남겨 복구하며 원래 오류를 전달한다. 예약 없는 무제한 경로의 저장 실패는 서버 오류 로그로 진단한다.
미완료 예약은 확정 실행 로그에 포함하지 않고 월 API의 예약 수치로 별도 표시한다.

추가 migration `20260918120000_add_console_request_metadata`는 nullable 필드만 추가한다.
과거 Bedrock의 경로·ID·모델·결과를 추정해 backfill하지 않는다. 이 기록의 경로는 `/bedrock`,
결과는 unknown이다. 기존 지식 answerStatus와 Family status는 알고 있는 결과로 인정한다.

## 2. 기간·조직·복구 귀속

`console-usage-events.ts`의 공통 SQL을 summary, timeseries, breakdown, 요청 목록·상세·CSV가 사용한다.

- 예약 연결 로그: 예약 organizationId와 periodKey에 귀속한다. 날짜는 예약 createdAt을 사용하며
  periodKey와 월이 다른 과거 기록은 승인 월 1일로 귀속한다. `occurredAt`은 집계 귀속 시각,
  `originalAt`은 원본 로그 시각이다. 앱 이동 뒤에도 이전 조직 기록을 새 조직에 보여주지 않는다.
- 예약 없는 로그: 원본 시각과 현재 앱 소유 조직을 사용한다. 과거 조직 소유권 이력이 없으므로
  예약 없는 과거 기록의 이전 조직을 재구성하지 않는다. 이동된 앱의 이전 조직 이름 대신 appcode만 표시한다.
- 원본 로그가 연결된 복구: 원본 요청 1건을 유지하며 누락 totalTokens만 SETTLED actualTokens로 보충한다.
  recoveryRequests/recoveryTokens를 별도 요청으로 중복 합산하지 않는다.
- 로그 없는 CONFIRM_USAGE: `recovery:reservationId` 1건, recoveryTokens를 표시한다.
  성공 여부·모델·지연은 알 수 없으므로 unknown/null이다. RELEASE는 요청·토큰에 포함하지 않는다.

최근 7/30/90일은 UTC 오늘을 포함하여 해당 날짜 00:00부터 조회 시점까지다.
`GET /console-api/v1/usage/monthly`와 요청 로그·CSV의 `period=month`는 UTC 당월 1일 이상,
다음 달 1일 미만이다. 월 API는 RepeatableRead 스냅샷으로 사용량·예약·정책을 읽는다.
서로 다른 API 호출 사이의 동시 신규 요청은 수치를 바꿀 수 있다.

## 3. 지표와 한도

- 요청 수: 해당 조건의 원본/유실 복구 요청 수. 성공률 분모는 성공+실패 결과가 측정된 요청 수다.
  unknown을 실패나 성공으로 간주하지 않는다. 분모 0이면 성공률 null이다.
- token 합계: 측정된 값과 확인된 복구 값만 합산한다. total/input/output의 measuredRequests를
  각각 제공한다. 측정 요청이 없으면 value=null이며 실제 0은 value=0이다.
  토큰 미측정 비율은 `(requestCount - tokenMeasuredRequests) / requestCount`이며 요청 0이면 해당 없음이다.
- 평균·최대·p50/p95: 지연이 측정된 요청만 사용한다. p50/p95는 PostgreSQL percentile_cont이며
  미측정/null을 0으로 넣지 않는다. summary·일별·앱별·차원별 API에서 제공한다.
- breakdown.dimensions: endpoint/model/status별 요청·token·결과·지연. modelId `unknown`은 미측정 모델 조회다.
  endpoint/modelId/status/appcode 필터는 생성 집계와 요청 로그·CSV에서 같은 조건을 사용한다.
- Embedding: `family_embedding_usage`의 INDEX/SEARCH operation 및 RESERVED/SUCCEEDED/UNCERTAIN만 집계한다.
  현재 앱 소유 조직·원장 createdAt 기준이며 생성 요청·token·지연에 합산하지 않는다.
  일반 지식 검색·색인 embedding은 계측 원장이 없어 미측정이다. 이를 전체 embedding의 0으로 해석하지 않는다.
  endpoint/model/status 필터가 있으면 별도 embedding을 제외하고 embeddingScope.filteredOut=true를 반환한다.

월 한도는 `used`(확인된 사용), `reserved`, `committed=used+reserved`, `remaining`,
`utilizationPercent`, `unmeasuredRequests`, `state`로 제공한다. 잔여량은 max(0, limit-committed),
사용률은 committed/limit의 백분율(100% 초과 허용)이다. null 한도는 unlimited, 0은 exhausted이며
0의 사용률은 나눗셈하지 않고 null이다. 미측정 token이 있으면 잔여량·사용률을 null로 둔다.
토큰 예약 추정치를 실측 token으로 표시하지 않는다.

같은 월 다른 조직의 예약이 있는 앱은 앱 한도가 조직 간 사용을 포함할 수 있다. 현재 조직 사용
소계만 노출하고 제한된 앱의 잔여량·사용률은 null, state=organization-changed로 표시한다.
플랫폼 관리자가 전체 원장을 확인해야 한다. 조직 한도 집계는 계속 승인 당시 조직 기준이다.

한도 설정 주체는 플랫폼 관리자다. 앱 한도는 관리자 `PATCH /app-info/:id`의 monthlyTokenLimit,
조직 한도는 console_organization.monthlyRequestLimit/monthlyTokenLimit의 승인된 DB 설정 절차로
관리한다. 현재 Console 앱 수정 API와 화면은 한도를 변경하지 않는다. 조직 한도 변경용 Console API는 없다.

## 4. 조회·검증

요청 목록은 기본 25/최대 100건, CSV는 최대 5,000건이며 초과 시 x-export-truncated=true를 반환한다.
cursor는 집계 시각과 source:UUID의 내림차순 복합 키다. 조직 조건은 매 요청에 다시 적용한다.
CSV는 수식 접두사를 중립화하고 logId·원본 시각·복구 근거를 포함한다. 화면의 앱·차원·월 로그 링크는
해당 기간·필터를 전달한다.

검증은 `npm run test:console-usage-db`(localhost 무작위 격리 PostgreSQL),
`npm run test:usage-quota-db`, 관련 서버 suite 및 `npm run test:console-web`로 재실행한다.
검증 횟수·날짜·한계는 [마일스톤 M2 기록](HJ_AI_CONSOLE_MILESTONES.md)에 보존한다.
M2의 Web 렌더 시험은 VM에서 실제 markup 함수를 실행하는 검사이며 브라우저 E2E는 M3다.
운영 DB migration·실제 AWS·배포 검증을 대신하지 않는다.
