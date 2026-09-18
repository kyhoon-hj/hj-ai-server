# Console 월 한도 예약 복구 운영 절차

작성일·갱신일: 2026-09-18 · 대상 작업: M1-03~04 · 대상 프로젝트: HJ_AI_Server

## 1. 적용 범위와 배포 전제

관리자 API는 잔류 RESERVED/UNCERTAIN 예약을 조사하고 근거에 따라 SETTLED로 확정한다.
오래된 예약을 주기적으로 자동 해제하지 않는다. 사용량이 불명확하면 예약을 유지한다.

필요 migration: `20260918100000_add_usage_reservation_recovery`,
`20260918110000_add_usage_reservation_policy`.
기존 `20260917100000_add_console_usage_reservation` 적용 후 추가한다. migration을 먼저 적용한 뒤
새 코드를 배포한다. 운영 적용 전 백업·격리 DB rehearsal과 M1-05 검증이 필요하다.
이번 개발에서 migration deploy, 실제 복구 API 호출, 운영 배포는 수행하지 않았다.

추가 컬럼은 nullable 또는 0 기본값이다. 기존 예약을 자동 backfill하지 않는다.
usageLogSource/usageLogId와 recoveryKey는 각각 unique다. 원래 로그와 복구 근거를 삭제하지 않는다.
복구 후 구버전 한도 코드로 돌아가면 recoveryRequests/recoveryTokens가 계산에서 빠지므로,
복구 기록이 생긴 환경에서의 코드 rollback은 이 집계를 지원하는 버전으로 제한한다.

## 2. 인증 및 조회

플랫폼 관리자 credential을 `x-admin-key` 헤더로 사용한다. knowledge-operator, 앱 키와
Console 일반 세션은 이 API의 권한이 아니다. credential은 브라우저, URL, 티켓 본문에 기록하지 않는다.

| 메서드 | 경로 | 목적 |
| --- | --- | --- |
| GET | `/admin/v1/usage-quota/reservations` | 기본: 15분 이상 갱신되지 않은 RESERVED/UNCERTAIN 조회 |
| GET | `/admin/v1/usage-quota/reservations/:id` | 상태와 updatedAt, 로그 참조, 복구 계수 확인 |
| POST | `/admin/v1/usage-quota/reservations/:id/reconcile` | 근거를 확정한 예약 1건 복구 |

목록 필터: appcode, organizationId(UUID), periodKey(YYYY-MM), state, updatedBefore(ISO 날짜),
after(UUID cursor), limit(1~200, 기본 50). ID 오름차순 keyset이며 nextCursor가 null이면 마지막이다.
목록은 실시간 상태이므로 복구 직전에 상세를 다시 조회한다. 질문·답변 원문은 응답에 포함하지 않는다.

예: `GET /admin/v1/usage-quota/reservations?appcode=APP&periodKey=2026-09&limit=50`

## 3. 실행 중지와 근거 확인

1. 해당 앱의 생성 요청 유입과 진행 중 실행을 중지·drain한다. 재시도 작업도 포함한다.
   프로세스 중단 사고라면 이전 인스턴스가 다시 실행하거나 늦은 결과를 기록할 수 없는지 확인한다.
   AWS timeout/네트워크 단절만으로 provider 미실행이나 토큰 0을 추정하지 않는다.
2. 예약의 appcode, periodKey, operationKeyHash, reservedRequests/tokens, usageLogSource/id를 확인한다.
   기본 최소 유휴 시간은 15분이다. 이 시간은 안전한 lease 보장이 아니며 실행 중지 확인을 대체하지 않는다.
3. 원래 실행 로그 또는 provider 관측 기록을 확인한다. 신규 로그는 같은 트랜잭션에서 예약에 연결된다.
   기존 예약의 연결이 없으면 운영자가 해당 로그의 실제 동일 요청 여부를 확인한다.
   requestId가 있는 지식·Family 로그는 서버가 operation hash도 대조한다.
   Bedrock 과거 로그처럼 requestId가 없으면 앱·시간만으로 동일 요청이라고 단정하지 않는다.
4. 장애 티켓에 확인자, 실행 중지 근거, provider 호출 여부, 토큰 수 출처, 원래 로그 ID를 기록한다.
   API evidenceRef에는 티켓/증거 식별자만 넣는다. 원문·비밀값·개인정보를 넣지 않는다.
5. 상세를 다시 읽어 updatedAt을 고정하고 다음 표에 맞는 조치를 선택한다. 근거가 부족하면 보류한다.

| 상황 | action | 입력·계수 |
| --- | --- | --- |
| 로그 저장 성공, 정산 실패 또는 프로세스 중단 | SETTLE_LOG | 연결 로그 사용. 측정 토큰이 있으면 actualTokens 생략 가능. 요청·토큰을 다시 더하지 않음 |
| 기존 버전 예약에 로그 참조가 없지만 동일 로그를 확인함 | SETTLE_LOG | logSource와 logId를 함께 지정. 동일 앱·UTC 월·가능한 requestId를 검증 |
| 로그는 있으나 토큰 미측정 | SETTLE_LOG | 확인된 actualTokens 필수. 요청은 로그에서, 누락 토큰만 복구 원장에서 계수 |
| 로그 유실, provider 사용량 확인 | CONFIRM_USAGE | actualTokens 필수. 복구 원장에 요청 1건과 확인 토큰을 반영 |
| 로그 없음, 실행되지 않았음이 확인됨 | RELEASE | actualTokens를 보내지 않음. 요청·토큰 예약 해제 |
| provider 실행/토큰 또는 동일 로그 여부 불명확 | 처리 보류 | RESERVED/UNCERTAIN 유지, 추가 조사 |

reservedRequests=0이면 로그로 요청 계수가 이전된 상태다. 로그 참조가 없는 기존 예약이라도
CONFIRM_USAGE/RELEASE로 덮어쓰지 않고 동일 로그를 찾아 SETTLE_LOG를 사용한다.
이미 연결된 로그를 다른 로그로 바꾸거나 한 로그를 여러 예약에 사용하는 요청은 거절한다.
연결된 로그는 월을 넘어 완료되어도 예약 승인 월로 SETTLE_LOG 정산한다. 연결 없는 과거 로그를
수동 지정할 때는 같은 UTC 월이어야 한다. [월 한도 정책](HJ_AI_CONSOLE_QUOTA_POLICY.md)을 함께 확인한다.

## 4. 복구 요청과 재시도

다음은 형태 예시다. id, recoveryKey, expectedUpdatedAt과 근거는 실제 조회·조사 결과를 사용한다.
recoveryKey는 복구 시도마다 발급한 UUID이며, 응답 유실 시 새로 만들지 않는다.

```http
POST /admin/v1/usage-quota/reservations/<reservation UUID>/reconcile
Content-Type: application/json
x-admin-key: <platform administrator credential>
```

```json
{
  "recoveryKey": "11111111-1111-4111-8111-111111111111",
  "expectedUpdatedAt": "2026-09-18T01:00:00.000Z",
  "executorStopped": true,
  "evidenceRef": "INC-123",
  "action": "SETTLE_LOG"
}
```

CONFIRM_USAGE는 `"actualTokens": 25`처럼 실제 확인한 정수(0~2147483647)를 추가한다.
기존 로그를 지정할 때 logSource는 bedrock / knowledge / conversation이고 logId는 UUID다.
RELEASE는 토큰 입력과 로그 참조를 보내지 않는다.

성공은 200이며 SETTLED 상태를 반환한다. 동일 예약·recoveryKey·본문의 재전송은 같은 결과를
반환하고 사용량·감사를 추가하지 않는다. 결과가 불명확한 5xx/연결 단절에서는 같은 본문과 키로
재시도한다. 다른 값으로 재시도하기 전에 상세 및 감사 기록을 확인한다.

| 결과 | 조치 |
| --- | --- |
| 400 | DTO, 필수 근거·토큰·로그 참조 쌍 확인 |
| 401 / 403 | 관리자 credential/역할 확인 |
| 404 | 예약 ID와 대상 환경 확인 |
| 409 RESERVATION_CHANGED | 상세 재조회, 진행 중 작업 여부 재확인. 기존 expectedUpdatedAt을 임의 수정해 강행하지 않음 |
| 409 EXECUTOR_NOT_QUIESCED | 15분 유휴 조건·실행 중지 확인 |
| 409 USAGE_UNMEASURED | 사용량 근거 확보, 추정값을 실측으로 취급하지 않음 |
| 409 LOG_* / ACTUAL_TOKENS_MISMATCH | 동일 요청·앱·월·토큰 및 기존 로그 연결 확인 |
| 409 RECOVERY_CONFLICT / RECOVERY_REFERENCE_ALREADY_USED | 기존 복구 키·로그 중복 조사. 중복 효과를 만들지 않음 |
| 5xx | DB·감사 저장 상태 조사 후 동일 키/본문 재시도 |

오류 코드의 실제 접두사는 `USAGE_QUOTA_`다. 정상 정산·로그 저장·수동 복구는 같은 조직 → 앱
advisory lock 순서를 사용한다. 상태 변경은 updatedAt을 조건으로 다시 확인한다. 복구 결정 감사
`USAGE_QUOTA_RESERVATION_RECOVERED`가 저장되지 않으면 상태 변경도 롤백한다.

## 5. 사후 확인과 제한

상세의 state=SETTLED, actualTokens, recoveryKey, usageLogSource/id, recoveryRequests/recoveryTokens를
감사 이벤트와 대조한다. 감사에는 이전 상태·예약 수량·근거 식별자·credential slot이 남는다.
이미 SETTLED인 예약을 다른 수치로 수정하는 API는 제공하지 않는다. 잘못된 복구는 별도 사고로 조사한다.

복구 원장의 계수는 원래 periodKey의 월 한도에 합산된다. 기존 로그가 있는 경우 로그 수량과 중복
합산하지 않는다. CONFIRM_USAGE는 원래 API를 재호출하거나 응답을 복원하지 않는다.
Console 일반 사용량·요청 로그 UI/CSV에 복구 원장을 통합하는 작업은 M2에 남아 있으므로, 이 단계에서
UI 숫자를 복구 검증 근거로 삼지 않는다. 미측정 로그를 나중에 직접 수정하면 복구 토큰과 이중 합산될 수
있으므로 원본 로그의 임의 수정도 금지한다. 연결 로그의 월·조직은 예약 기준으로 고정한다.

M1-03~04의 초기 검증은 provider·Prisma·트랜잭션 mock 및 관리자 HTTP 테스트다.
후속 M1-05(2026-09-18)는 `npm run test:usage-quota-db`로 격리 PostgreSQL 18.4에서
16개 검증을 통과했다. 실제 migration/backfill·월/조직 귀속·독립 프로세스 중단·복구 경합·
감사 실패 롤백·복구 HTTP 멱등성을 확인했다. 복구 응답 유실은 결과를 버린 뒤 재시도하는 방식이며
COMMIT 네트워크 패킷 유실 주입은 미실행이다. 운영 데이터 rehearsal과 실제 AWS 검증을 대체하지 않는다.
검증 근거·제한: [마일스톤 M1-05](HJ_AI_CONSOLE_MILESTONES.md).
