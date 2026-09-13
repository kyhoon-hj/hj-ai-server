# HJ-Works 사용자·조직·멤버십 계약 v1

작성일: 2026-09-12

작업 ID: `CON-WORKS-02`

상태: AI Server 계약 초안·fixture 검증 완료, HJ-Works 공동 승인 대기

## 1. 계약 범위

이 문서는 HJ-Works SSO v1 코드 교환 결과를 AI Console identity와 조직 binding으로
변환하는 계약을 정의한다. 인증 code 발급·교환 자체는
`HJ_WORKS_AUTH_DISCOVERY_2026-09-11.md`의 확인 결과를 따른다.

계약 버전은 `hj-works-sso-v1`, issuer는 `HJ_WORKS`로 고정한다. 표준 OIDC claim으로
해석하거나 OIDC 호환 계약으로 표시하지 않는다.

## 2. 불변 식별자

| 대상 | 관계 key | 규칙 |
| --- | --- | --- |
| 사용자 | `(issuer, worksUserId)` | Works 내부 UUID를 사용하며 이메일을 key로 사용하지 않는다. |
| 조직 | `(issuer, worksOrganizationId)` | Works tenant UUID를 사용하며 이름·slug를 key로 사용하지 않는다. |
| 멤버십 | `(issuer, worksOrganizationId, worksUserId)` | 역할과 상태는 변경 가능한 snapshot이다. |

Works는 삭제된 사용자·tenant UUID를 다른 주체에 재사용하지 않아야 한다. 이메일,
표시 이름, 회사 이름과 slug는 변경 가능한 표시 정보로만 캐시한다. ID 변경이 필요한
데이터 정정은 기존 binding 수정이 아니라 명시적 이전 절차와 감사 이벤트로 처리한다.

## 3. SSO v1 응답 계약

필수 필드는 `userId`, `tenantId`, `membershipRole`, `user`, `tenant`, `expiresAt`이다.

- `userId`와 `user.id`, `tenantId`와 `tenant.id`는 각각 동일한 UUID여야 한다.
- `membershipRole`은 `OWNER`, `ADMIN`, `MEMBER` 중 하나다.
- `user.email`, `user.displayName`, `tenant.name`, `tenant.slug`는 비어 있을 수 없다.
- `expiresAt`은 교환 검증 시각보다 미래여야 한다.
- 버전 계약에 없는 필드와 알 수 없는 역할은 fail-closed로 거절한다.

검증 구현과 공유 fixture는 각각
`src/console/contracts/hj-works-identity.contract.ts`와
`src/console/contracts/fixtures/hj-works-sso-v1.json`에 둔다.

## 4. 멤버십 수명주기

SSO 교환 성공은 해당 시점에 사용자, tenant, membership과 서비스 배정이 유효했다는
snapshot만 증명한다. Console은 이를 무기한 권한으로 취급하지 않는다.

| 변화 | Console 처리 |
| --- | --- |
| 표시 정보 변경 | 다음 동기화에서 cache 갱신, binding key 유지 |
| 역할 변경 | permission 재계산, 기존 조직 세션의 권한 snapshot 폐기 |
| membership 제거 | 해당 사용자·조직의 Console session 폐기 |
| 사용자·조직·서비스 정지 | 관련 Console session 폐기 및 신규 민감 작업 차단 |
| membership 재가입 | 동일 관계 key의 새 활성 기간으로 기록하고 권한 재계산 |

현재 Works SSO v1에는 교환 이후 변경 event나 introspection이 없다. 최대 철회 지연,
재검증 TTL과 event 재전송 계약은 `CON-WORKS-04`, 로그아웃·정지 정책은
`CON-WORKS-05`에서 확정한다. 그 전에는 장기 Console session을 운영 승인하지 않는다.

## 5. AppInfo 조직 소유권 migration preflight

기존 `AppInfo`에는 Works 조직 FK가 없으므로 appcode나 이름으로 자동 연결하지 않는다.
운영자가 검토한 `(appInfoId, worksOrganizationId)` manifest만 migration 입력으로 받는다.

적용 전 dry-run은 다음 조건을 모두 검사하고 하나라도 실패하면 쓰기를 시작하지 않는다.

1. 모든 ID가 UUID이고 대상 AppInfo와 Works 조직이 존재한다.
2. 대상 Works 조직과 AI Console 서비스 배정이 ACTIVE다.
3. 각 AppInfo는 정확히 하나의 조직에만 연결된다.
4. 중복 appInfoId, 중복 manifest 행과 미소유 대상 AppInfo가 없다.
5. 기존 appcode, appkey hash, 이전 key와 만료 정보는 변경하지 않는다.
6. 적용 건수와 제외·오류 목록을 승인 가능한 report로 남긴다.

소유권 schema는 additive migration으로 추가하고, pilot 대상만 먼저 연결한다. rollback은
소유권 행 또는 nullable FK만 되돌리며 기존 AppInfo와 외부 `/v1` 호출을 유지해야 한다.

## 6. 공동 승인 항목

- Works UUID 비재사용 보장과 삭제·병합 정책
- membership 제거 후 재가입의 version 또는 활성 기간 식별 방식
- 역할 변경·탈퇴·정지 event의 schema와 최대 전달 지연
- 다중 조직 사용자의 전체 membership 조회 또는 조직 선택 계약
- fixture를 HJ-Works 계약 시험에도 복제하거나 단일 배포 artifact로 공유하는 방식

위 항목을 HJ-Works와 승인하면 `CON-WORKS-02`를 완료 처리한다. 기능 schema는
`ConsoleIdentityContext` 경계를 기준으로 먼저 구현했으며, 공동 승인과 실제 Works
SSO/session adapter 검증이 끝나기 전에는 Console API를 운영에 공개하지 않는다.
