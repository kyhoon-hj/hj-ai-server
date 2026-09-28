# Console 활동·보안 감사 계약 (M4)

작성일: 2026-09-28. 대상: HJ_AI_Server Console API/Web.

기준: [전체 마일스톤](HJ_AI_CONSOLE_MILESTONES.md),
[구현 진행 현황](HJ_AI_CONSOLE_PROGRESS_2026-09-13.md).

## 1. 조회 권한과 조직 경계

`GET /console-api/v1/audit-events`는 `audit:read` permission이 필요하다. 조회 대상
`consoleOrganizationId`는 query로 받지 않고 인증된 `ConsoleIdentityContext.organizationId`로
강제한다. 다른 조직의 event는 event ID·앱·행위자·metadata를 포함해 존재 여부를 노출하지 않는다.

지원 필터는 최근 7/30/90일, event type, 조직 소유 앱 ID, Works 사용자 UUID다. 기본 25건,
최대 100건이며 `createdAt DESC, id DESC` cursor pagination을 사용한다. 잘못된 cursor는
`INVALID_AUDIT_CURSOR`로 거절한다.

## 2. 반환 projection과 원문 비노출

응답은 event ID/type/시각, 앱 ID·코드, request ID, method/path, Console/Works 불변 행위자 ID와
허용된 상세 필드만 포함한다. 다음 정보는 반환하지 않는다.

- `consoleSessionIdHash`, credential hash·원문, idempotency/recovery key
- 임의 metadata object, 요청·응답 body, 질문·답변과 사용자 profile
- 다른 조직의 앱·행위자 식별자

상세 allowlist는 `action`, `changedFields`, `credentialId`, `evidenceRef`, `expiresAt`,
`gracePeriodSeconds`, `previousCredentialValidUntil`, `previousState`, `reservationId`, `slot`이다.
값은 null/string/number/boolean만 허용하며 object·array는 제외한다. 새 event 상세 필드는 검토 후
allowlist와 시험을 함께 변경해야 한다.

## 3. 저장 실패 정책

Console 앱·credential 변경 감사 기록은 현재 변경 transaction이 commit된 뒤 저장하는
best-effort 활동 감사다. 저장 실패 시 `SecurityAuditService`가 오류를 기록하고 `false`를 반환하며,
이미 성공한 사용자 변경을 되돌리거나 실패로 응답하지 않는다. commit 뒤 감사 실패를 이유로 API를
실패시키면 사용자가 변경이 실패했다고 오인하고 재시도할 수 있기 때문이다.

한도 복구처럼 감사 자체가 복구 결정 원장인 작업은 예외다. 해당 event는 업무 변경과 같은 DB
transaction에서 저장하며 실패 시 전체를 rollback한다. 향후 fail-closed가 필요한 Console 작업도
동일한 transaction 패턴을 사용해야 한다.

감사 조회 자체는 event를 추가하지 않는다. 조회를 기록하면 pagination 중 읽기 event가 계속 생기는
재귀적 목록 변화를 만들기 때문이다. best-effort 저장 오류의 운영 경보 연결은 M7 관측성 범위이며,
현재 정책은 서버 error log와 반환 boolean을 기준으로 한다.

## 4. 검증

단위·HTTP 시험은 permission, query 검증, 조직 강제 범위, cursor, allowlist projection과 저장 실패
반환 정책을 검사한다. `npm run test:console-access-db`는 격리 PostgreSQL에서 두 조직 event를 만들고
타 조직 비노출과 session hash·비허용 metadata 제거를 확인한다. 실제 운영 DB와 운영 관측 경보는
M7 이전에 별도 검증한다.
