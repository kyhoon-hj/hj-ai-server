# Console 월 한도 적용 정책

작성일: 2026-09-18 · 작업: M1-04 · 대상: HJ_AI_Server

이 문서는 M1-01~03의 과거 검증 기록 이후 적용되는 정책이다.
범위는 지식 답변, Bedrock converse/text-response/general-answers, 일반·Family 대화 생성이다.
검색·파일 색인 embedding은 이 생성 토큰 한도에서 제외한다.

## 1. 월 귀속과 조직

예약은 조직 → 앱 잠금을 얻은 뒤 승인 시점의 UTC YYYY-MM을 periodKey로 고정한다.
월 구간은 UTC 매월 1일 00:00:00 이상, 다음 달 1일 00:00:00 미만이다.
9월 말 접수했어도 잠금 대기가 10월까지 이어지면 10월 예약이다.
승인이 9월에 끝났다면 모델 응답·로그·재정산이 10월이어도 요청과 토큰은 9월에 귀속한다.

로그 원래 시각은 변경하지 않는다. 월 한도 SQL은 usageLogSource/id로 연결된 예약의 periodKey와
organizationId를 사용한다. 신규 요청은 새달의 독립 한도를 사용하며 이전 달의 불확실 예약을
새달로 이동시키지 않는다. 복구 원장의 누락 요청·토큰도 원래 periodKey를 사용한다.

예약 없는 무제한 호출과 연결 없는 과거 로그는 기록 시각의 UTC 월·현재 앱 소유 조직을 사용한다.
이는 과거 로그에 없는 승인 시각/조직을 추정하지 않기 위한 fallback이다. 예약 이후 소유 조직이
바뀌면 토큰 예약에서 USAGE_QUOTA_ORGANIZATION_CHANGED(409)로 거절한다.
조직 이동·한도 설정 변경은 진행 중 요청을 drain한 뒤 수행해야 한다. 이동·정책 변경의 별도 API는 추가하지 않았다.

## 2. operation과 재시도

한도 원장의 중복 범위는 `앱 + 승인 UTC 월 + operationScope + operationKey`다.
식별자는 대소문자를 포함한 원문 문자열을 기준으로 한다. 같은 범위의 예약이 존재하면 409이며,
SETTLED/UNCERTAIN도 중복을 막는다. 이미 실패한 키로 모델을 다시 호출하지 않는다.

| API | operationScope | operationKey |
| --- | --- | --- |
| knowledge answers / rag-response | knowledge.answer (동일 구현의 별칭) | x-correlation-id, 미지정 시 서버 UUID |
| bedrock converse | bedrock.converse | x-correlation-id, 미지정 시 서버 UUID |
| bedrock text-response | bedrock.text-response | x-correlation-id, 미지정 시 서버 UUID |
| bedrock general-answers | bedrock.general-answers | x-correlation-id, 미지정 시 서버 UUID |
| conversation turns | conversation:SHA256([tenantRef, sessionRef]) | DTO requestId |

text-response는 내부 converse에서 한 번만 예약한다. 서로 다른 생성 경로·대화 tenant/session의
같은 requestId는 별개다. 대화 namespace에는 tenant/session 원문 대신 hash를 저장한다.
SDK 내부 재시도는 같은 예약 안에서 수행한다. 다음 달에는 같은 operationKey라도 새 범위다.
대화 서비스의 기존 짧은 응답 replay/tombstone 정책은 별도로 유지한다.

기존 원장은 scope=legacy와 이전 `[앱, 월, key]` hash를 유지한다. 전환 월의 같은 legacy key가
있으면 신규 scope에도 보수적으로 409를 반환한다. 과거 기록의 경로를 추정해 재분류하지 않는다.
모든 한도가 null인 경우 원장을 만들지 않으므로 이 원장 기반 중복 방지는 적용되지 않는다.
한도 예약은 전체 API의 응답 재생이나 영구적인 멱등 API 계약을 뜻하지 않는다.

## 3. 추정·실측·초과 정책

호출 전 예약 추정식은 `maxOutputTokens + ceil(입력 UTF-16 code unit 길이 / 4)`다.
지식은 최종 prompt·system·지시문, Bedrock은 실제 message·system, 대화는 system과
JSON 직렬화한 messages(근거 포함)를 입력으로 사용한다. provider tokenizer 호출·추가 의존성은 없다.

이 추정식의 오차를 일정 비율로 보장하지 않는다. 현재 한도는 **추정치에 따른 호출 승인 한도**이며,
실측 토큰을 강제로 잘라 정확한 월 최대치에 맞추는 정책이 아니다.
- 실측이 추정보다 작으면 로그 저장 트랜잭션에서 추정 예약을 해제하고 실측을 반영한다.
- 실측이 추정보다 크면 초과분을 포함한 전량을 기록한다. 완료된 응답을 한도 사유로 폐기하거나
  수치를 한도 값으로 절삭하지 않는다. 실제 사용량이 한도에 도달/초과하면 이후 양수 토큰 요청은 429다.
- 동시에 이미 승인된 요청들의 실측 초과는 모두 반영되므로 초과량에 고정 상한을 보장하지 않는다.
  이러한 허용 초과가 부적합한 운영은 정확한 tokenizer/상한 정책을 별도 설계해야 한다.
- 로그 저장 후 정산 DB 오류가 나도 실측과 추정치를 동시에 계수하지 않는다. actualTokens와
  reservedTokens=0을 로그 참조와 함께 저장한다. 상태 복구는 M1-03 API로 한다.

예: 한도 100, 추정 80, 실측 20이면 잔여 80을 승인할 수 있다. 실측 120이면 120을 반영하고
다음 1토큰 요청을 거절한다. 경계에서 합계=한도는 허용하고 합계>한도는 거절한다.

## 4. 미측정·0·무제한

| 상태 | 정책 |
| --- | --- |
| 앱/조직 한도 null | 해당 한도 검사 생략. 모든 한도 null이면 예약도 생략 |
| 조직 요청 한도 0 | 모든 새 생성 요청 승인 거절 |
| 앱/조직 토큰 한도 0 | 양수 추정 거절. 생성하지 않는 지식 no-answer의 실측 0은 허용 |
| provider totalTokens=0 | 유효한 실측 0 |
| totalTokens 누락/null/음수/소수/범위 초과 | 미측정. 0으로 대체하지 않고 UNCERTAIN 및 추정 예약 유지 |
| 생성 전 실패/지식 근거 없음 | 모델을 호출하지 않은 것이 확인된 경우 생성 토큰 0 기록·정산 |
| 연결된 미측정 로그와 활성 예약 | 요청은 로그에서 1번, 토큰은 추정 예약에서 계수 |
| 예약 없는 과거 미측정 로그 | 토큰 한도가 있는 범위에서 USAGE_QUOTA_USAGE_UNMEASURED(503). 요청 한도만 있는 범위는 계속 검사 가능 |

요청 한도는 기존처럼 기록된 성공·실패/미생성 결과와 로그 없는 활성 예약을 포함한다.
토큰 예약 거절 후 로그를 남기는 지식 경로와 로그를 남기지 않는 Bedrock/대화 경로의 실패 로그
공통화는 M2에서 다룬다. 인증·요청 DTO·모델 설정 검증 전에 한도를 소비하도록 바꾸지는 않았다.

예약·실측 입력은 0~2147483647 정수다. tokensReservedAt으로 0토큰 예약도 두 번 예약할 수 없게 한다.
과거 미측정 로그는 검증된 측정 자료가 없으면 임의로 0으로 보정하지 않는다. 같은 월의 토큰 한도를
켜기 전에 해당 데이터를 확인해야 한다. 예약이 없는 과거 로그의 보정은 운영 검토를 거친 별도 데이터
정비 범위이며 복구 API가 가짜 예약을 자동 생성하지 않는다. 다음 달에는 지난달 미측정이 영향을 주지 않는다.

## 5. migration·검증·후속 작업

migration 순서: `20260917100000_add_console_usage_reservation` →
`20260918100000_add_usage_reservation_recovery` → `20260918110000_add_usage_reservation_policy`.
정책 migration은 scope=legacy를 추가하고 기존 양수 토큰 예약에 tokensReservedAt을 설정한다.
이미 연결된 실측 로그의 활성 예약만 추정 토큰을 해제하고 actualTokens를 채운다. 이 행은 updatedAt도
바뀌므로 이전 관리자 snapshot은 재조회해야 한다. 미연결·미측정 기록은 추측해서 변경하지 않는다.
이전 버전과 혼합 실행하지 말고 실행을 drain한 상태에서 migration 후 새 버전을 시작한다.

2026-09-18 검증: 23 suites / 254 tests, typecheck, lint:check, Prisma validate와 build.
provider·Prisma·직렬화 트랜잭션 mock 및 HTTP 계약 테스트이며 SQL의 실제 PostgreSQL 실행·월 경계
다중 프로세스·migration rehearsal은 M1-05에 남는다. 운영 DB 변경·배포는 하지 않았다.

후속 검증(2026-09-18, M1-05): `npm run test:usage-quota-db`로 로컬 PostgreSQL 18.4의
격리 DB에서 16개 통합 검증을 통과했다. migration/backfill·집계·별도 프로세스 경합·중단 후
복구를 확인했다. 월 경계는 승인 월과 로그 시각 fixture를 사용했다.
자세한 근거와 제한은 [마일스톤 M1-05](HJ_AI_CONSOLE_MILESTONES.md)를 참조한다.
M2에서는 일반 Console 사용량·로그·CSV에도 승인 월/조직 귀속과 복구 원장의 합산 정책을 연결한다.
