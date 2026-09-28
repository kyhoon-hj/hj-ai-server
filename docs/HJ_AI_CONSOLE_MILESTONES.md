# HJ AI Console 전체 마일스톤

작성일: 2026-09-18 · 최종 갱신일: 2026-09-28

대상: HJ_AI_Server의 Console API, Console Web/BFF 및 관련 사용량 처리

기준: [구축 계획](HJ_WORKS_AI_CONSOLE_IMPLEMENTATION_PLAN.md), [구현 진행 현황](HJ_AI_CONSOLE_PROGRESS_2026-09-13.md)

## 1. 현재 진행 단계

> **[Console M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 4/5]**
>
> 다음 착수 대상: `M4-05` 임계치·감사·홈 최종 DB·브라우저 회귀 검증.
>
> 직전 완료: `M4-04` 내부 알림함 채널·수신/재조회 정책과 상태 UX 연결.
>
> 전체: **8개 중 4개 마일스톤 완료**, 잔여 실행 작업 **19/35 완료**.
>
> 현재 알려진 차단 사유: 없음. M6에는 HJ-Works 계약 공동 확정이 필요함.
>
> 이번 변경 범위: M4-04 사용량 알림 API·홈 알림함·부분 실패 및 상태 UX.

```text
M0 완료 → M1 완료 → M2 완료 → M3 완료 → M4 진행 중 → M5 대기 → M6 대기 → M7 대기
기준선     월 한도       집계·로그  통합검증   홈·알림       지식관리   SSO       운영공개
```

완료 개수는 체크리스트 추적용이며 개발 공수나 제품 완성률을 뜻하지 않는다. 기존 앱·키·
Playground 등의 구현은 재사용하며, 아래 잔여 작업과 공개 전 검증이 끝나야 운영 MVP가 완료된다.

## 2. 상태 및 갱신 규칙

| 상태 | 표시 조건 |
| --- | --- |
| 대기 | 범위와 완료 기준은 정했으나 실제 작업 미착수 |
| 진행 중 | 구현·수정 또는 검증 환경 준비에 착수 |
| 검증 중 | 구현 후 해당 단계의 완료 기준 확인 중 |
| 완료 | 모든 작업 체크와 완료 기준을 충족하고 검증 근거 기록 |
| 차단 | 외부 계약·환경 등으로 진행 불가. 사유와 해소 조건 기록 |

1. 시작 시 이 문서에서 현재 단계를 확인하고 사용자 안내에 단계 표시를 넣는다.
2. 작업 ID 단위로 수행하고 완료 항목만 체크한다. 부분 완료는 항목 아래에 남은 범위를 적는다.
3. 종료 시 현재 단계 배너·전체 표·체크리스트·검증 기록·다음 작업·변경 이력을 함께 갱신한다.
4. 단계 완료 후 다음 단계를 현재 착수 대상으로 옮기되, 실제 착수 전에는 `대기`를 유지한다.
5. 실패 시 실행 명령, 핵심 로그, 영향과 남은 위험을 남긴다. 테스트 실패 디버깅·수정은 전역 지침의 최대 2회 제한을 따른다.
6. 선행 단계가 미완료인 상태에서 독립 작업을 먼저 수행하면 이유와 작업 ID를 기록한다. 기능별 회귀 검증은 각 단계에서 수행하며 M3까지 미루지 않는다.
7. 상태의 기준은 이 문서다. 기존 계획의 `CON-*` ID는 유지하고 아래 대응표로 연결한다.

진행 표시 예시(실제 상태가 아닌 형식 예시):

```text
[Console M1 | 월 한도 정합성 보완 | 진행 중 | 1/5]
수행: M1-02 예약·실행 로그 중복 계산 수정
검증: 실행한 명령과 Pass/Fail 또는 미실행 사유
다음: M1-03 불확실 예약 복구
```

## 3. 전체 마일스톤

| 단계 | 목표 | 상태 | 완료/전체 | 선행 조건 | 기존 계획 대응 |
| --- | --- | --- | --- | --- | --- |
| M0 | 현황·검증 기준선 확정 | 완료 | 3/3 | 없음 | 기존 단계 0~2 검토 |
| M1 | 월 한도 적용·예약·정산 정합성 | 완료 | 5/5 | M0 | CON-SRV-13 |
| M2 | 사용량·요청 로그·운영 지표 일치 | 완료 | 5/5 | M1 | CON-SRV-10~12, CON-WEB-06 보완 |
| M3 | DB·브라우저 통합 검증과 CI | 완료 | 5/5 | M1, M2 | 테스트 전략 §14, CON-OPS-05 일부 |
| M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 4/5 | M2, M3 | 임계치·감사·홈 최종 회귀 잔여 |
| M5 | 조직 범위 지식 관리 | 대기 | 0/5 | M3, M4 | CON-SRV-15~16, CON-WEB-07~08 |
| M6 | HJ-Works 인증·권한·세션 통합 | 대기 | 0/5 | M5, Works 공동 계약 확정 | CON-WORKS-02~05, CON-SRV-02·04, CON-WEB-01 |
| M7 | 운영 준비·pilot·공개 | 대기 | 0/5 | M0~M6 완료 | CON-OPS-01~06 |

HJ-Works 계약 질의·협의 자료 준비는 M1~M5 중에도 가능하다. HJ-Works 저장소 수정은 이
프로젝트 작업에 포함하지 않으며, 실제 협의·변경·배포는 해당 요청과 권한 범위에서 진행한다.

## 4. 단계별 작업 및 완료 기준

### M0. 현황·검증 기준선 확정 — 완료 (3/3)

- [x] `M0-01` 계획·진행 문서와 현재 소스의 구현 범위 대조.
- [x] `M0-02` 관련 서버·Web 테스트, 타입 검사, 린트 결과 및 검증 한계 기록.
- [x] `M0-03` 보완 우선순위, 전체 마일스톤, 단계 표시·갱신 규칙 수립.

완료 근거: §5의 2026-09-18 검증 기록과 이 문서. M0 완료는 기존 기능의 운영 검증 완료를 뜻하지 않는다.

### M1. 월 한도 정합성 보완 — 완료 (5/5)

- [x] `M1-01` 지식 답변·대화·Bedrock converse/text-response/general-answers별 한도 적용 계약을 정하고 누락된 생성 경로 연결.
- [x] `M1-02` 실패 로그와 활성·불확실 예약의 요청 수 중복 계산 제거. 요청 계수와 토큰 불확실성 분리.
- [x] `M1-03` 로그 저장 실패·정산 실패·프로세스 중단 시 RESERVED/UNCERTAIN 예약의 조회·복구·멱등 재정산 경로와 운영 절차 구현.
- [x] `M1-04` UTC 월 경계, 중복 operation 범위, 토큰 예약 추정과 실제 사용량 차이, 미측정·무제한·0 한도 정책 확정 및 경계 처리.
- [x] `M1-05` 실제 PostgreSQL의 별도 연결/프로세스로 조직·앱 한도 경계, 중복 요청, 실패 후 복구를 검증하고 관련 API 회귀 실행.

완료 기준: 적용 대상 API가 동일 정책을 지키고, 한 요청이 요청 한도에 중복 반영되지 않으며,
장애 후 예약 상태를 설명·복구할 수 있다. 추정 토큰과 실제 토큰의 허용 오차·초과 정책을
명시하고 시험한다. mock의 직렬화 결과만으로 DB 동시성 통과를 선언하지 않는다.

### M2. 사용량·요청 로그·운영 지표 일치 — 완료 (5/5)

- [x] `M2-01` Bedrock·지식·Family 대화의 요청 ID, endpoint, 결과, 오류 코드 공통 계약과 성공/실패 기록 구현.
- [x] `M2-02` Family 대화를 요청 로그·상세·CSV에 포함하고 사용량에서 요청 로그까지 추적 가능하게 연결. 기존 기록의 미측정 상태 처리.
- [x] `M2-03` UTC 이번 달 사용량·한도·잔여량·사용률 API를 추가하고 최근 7/30/90일 조회와 구분. 한도 설정 주체와 관리 경로 명시.
- [x] `M2-04` p50/p95, endpoint/model/status별 집계·endpoint 필터 및 embedding 집계 범위 확정·구현. 누락 계측과 실제 0 구분.
- [x] `M2-05` 동일 DB fixture의 원본·summary·timeseries·breakdown·로그·CSV 대조, 조직 격리·cursor·행 제한 회귀 검증.
  - M1-03 복구 원장(recoveryRequests/recoveryTokens)과 원래 로그의 중복 없는 집계·조회 연결도 포함한다.
  - M1-04 예약 승인 월·조직 귀속과 미측정 정책을 일반 Console 집계·로그·CSV에 동기화한다.

완료 기준: 동일 기간·대상·결과 정책에서 집계 수치가 원본과 일치한다. 성공률의 분모와
미측정 비율을 설명할 수 있고, 최근 30일을 이번 달 한도로 오인하는 화면이 없다.

### M3. 통합 검증과 CI — 완료 (5/5)

- [x] `M3-01` `test:console-web`을 기본 `verify`/CI 실행에 포함하고 Web 실패가 품질 검사를 실패시키는지 확인.
- [x] `M3-02` 조직 2개·역할별 DB fixture를 마련하고 앱·키·사용량·로그의 HTTP 허용/거부 계약 및 production fixture 차단 검증.
- [x] `M3-03` 앱 생성 → 키 발급 → 실제 API 계약 호출 → 사용량·로그 확인 및 키 회전/grace/폐기 브라우저 E2E 구현·실행. provider 대체 여부 명시.
- [x] `M3-04` 한도 초과·DB 실패·중복 요청·cursor·CSV 제한 등 M1/M2 회귀를 반복 실행할 수 있는 격리 환경과 CI/별도 실행 경로에 연결.
- [x] `M3-05` 관련 build/typecheck/lint/서버·Web·demo 검사 결과를 기록하고 실행 환경·대상 revision 또는 작업본 기준을 문서화.

완료 기준: 문자열 존재 검사 외에 사용자 행동과 DB 결과를 검증한다. 자동화 범위와 별도
통합 실행 범위를 구분하고 통과 증거를 남긴다. 이후 M4~M6 기능의 검증은 해당 단계에서 추가한다.

### M4. 홈·알림·감사 조회 — 진행 중 (4/5)

- [x] `M4-01` 월 사용량 70/90/100% 도달 event와 조직·기간·지표·임계치 기준 중복 방지 구현. 재시도·월 변경 정책 포함.
- [x] `M4-02` 홈에 이번 달 사용량·잔여 한도·성공률·p95·최근 오류·키 만료 표시. 지식 색인 실패는 M5에서 연결할 계약 마련.
- [x] `M4-03` 조직 범위 활동·보안 감사 조회 API와 화면, 권한·필터·원문 비노출 구현 및 감사 저장 실패 처리 정책 확정.
- [x] `M4-04` 알림 채널·수신 대상·재전송 정책 확정 및 연결. 0·무제한·미측정·읽기 전용·오류·빈 상태 UX 구현.
- [ ] `M4-05` 임계치 동시 도달·중복 전달·월 전환, 감사 격리, 홈 탐색·모바일·키보드 사용 회귀 검증.

완료 기준: 같은 임계치 알림이 정의된 범위에서 중복되지 않고 홈·상세 지표가 일치한다.
실제 수신자 메시지 발송은 별도 명시적 지시 범위에서만 수행하며 시험은 허용된 테스트 채널로 진행한다.

### M5. 조직 범위 지식 관리 — 대기 (0/5)

- [ ] `M5-01` 기존 지식 기능을 Console identity 기반 facade로 연결하고 앱 소유권·Knowledge Manager permission 적용.
- [ ] `M5-02` 파일 목록·상세·업로드·정책·게시 UI 및 API 구현. 파일·크기·저장 한도와 실패 응답 처리.
- [ ] `M5-03` 색인 상태·attempt·오류·재시도·재색인 화면을 연결하고 홈의 색인 실패 지표 완성.
- [ ] `M5-04` 게시·보관·안전한 삭제의 상태 전이와 감사·중복 요청·복구 처리 구현.
- [ ] `M5-05` 업로드 → 색인 → Playground 답변 → 재색인 → 보관 여정, 타 조직 file/job 직접 접근 거부, 브라우저 관리자 credential 비노출 검증.

완료 기준: Console 권한만으로 지식 수명주기를 운영하며 조직 격리와 상태 전이 회귀를 통과한다.

### M6. HJ-Works 로그인·권한·세션 통합 — 대기 (0/5)

- [ ] `M6-01` 불변 ID·역할·permission 소유권·복수 조직·권한 철회 지연·변경 event·로그아웃·MFA·개인정보 계약 공동 확정.
- [ ] `M6-02` SSO code 교환·callback·state 만료/단일 사용·Console session·cookie·CSRF 방어와 BFF 전달 계약 구현.
- [ ] `M6-03` 계정·membership 동기화, 서명 event 멱등성·순서 역전·재전송 처리와 세션 폐기 구현.
- [ ] `M6-04` 로그인·조직 선택·접근 거부·로그아웃 화면과 실제 권한별 UI 연결, fixture adapter 교체.
- [ ] `M6-05` staging 실계정 2개 조직·3개 이상 역할에서 SSO 실패·재전송·권한 회수·로그아웃·Works 장애 E2E, 기존 기능 회귀 및 production fixture 차단 검증.

완료 기준: 합의한 시간 안에 권한 회수가 반영되고 실계정 여정이 통과한다. 공동 계약이
미확정이면 이를 차단 사유로 표시하며 fixture 통과로 인증 통합 완료를 대신하지 않는다.

### M7. 운영 준비·pilot·공개 — 대기 (0/5)

- [ ] `M7-01` `/console`·`/console-api`·Playground 경로의 reverse proxy·CORS·CSP·feature flag와 외부 노출 정책 구성·검증.
- [ ] `M7-02` 기존 앱 ownership 사전 검사, migration backup·rehearsal·rollback 및 Console 비활성화 시 기존 AI API 유지 검증.
- [ ] `M7-03` SSO secret·session key rotation, 예약 복구, metric·alert·dashboard·장애 runbook 완성.
- [ ] `M7-04` 배포 후보의 전체 품질 검사·dependency/image scan·독립 보안·접근성 검수와 운영 대표 여정 통과 기록.
- [ ] `M7-05` pilot 조직·한도·관측 기준을 확정하고 배포 승인 기록 후 단계적 공개·관찰·인수인계 완료.

완료 기준: 미해결 공개 차단 항목이 없고 migration·rollback·로그인·키·사용량·지식 대표 여정의
증거와 승인 기록이 있다. 검증된 후보와 실제 배포된 revision·환경을 구분해 기록한다.

## 5. 검증 기준선과 알려진 보완 사항

2026-09-18 직전 검토에서 현재 작업본을 대상으로 실행한 결과다. 커밋되지 않은 변경을
포함하며 특정 배포 revision의 검증 결과가 아니다. 이번 문서 작성 작업에서 재실행한 결과로 취급하지 않는다.

| 명령 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run typecheck` | Pass | TypeScript 타입 검사 |
| `npm run lint:check` | Pass | 설정된 서버·test TypeScript 범위 |
| `npm run test:ci -- --testPathPatterns='console\|usage-quota\|knowledge.contract\|conversation'` | Pass — 18 suites, 120 tests | 선택 suite; 전체 서버 시험 아님 |
| `npm run test:console-web` | Pass — 21 tests | API/BFF·소스 계약 검사 포함; 브라우저 E2E 아님 |

실제 DB 동시성·브라우저 E2E·운영 DB·SSO·배포 시험은 이번 기준선에서 미실행이다.

| 소스 대조 결과 | 대응 작업 | 근거 |
| --- | --- | --- |
| 일반 Bedrock 생성 경로에 quota 연결 누락 | M1-01 | `src/bedrock/bedrock.service.ts` |
| 실패 로그와 UNCERTAIN 예약의 요청 수 중복 계산 가능, 잔류 예약 복구 경로 부재 | M1-02~03 | `src/usage-quota/usage-quota.service.ts`, `src/knowledge/knowledge.service.ts` |
| 사용량에는 Family 대화 포함, 요청 로그에는 미포함; Bedrock request ID·실패 추적 부족 | M2-01~02 | `src/console/usage/console-usage.service.ts`, `src/console/request-logs/console-request-logs.service.ts` |
| 월 사용률·p50/p95·차원별 집계·endpoint 필터 잔여 | M2-03~04 | 구축 계획 §9~10과 현재 usage/log DTO·서비스 |
| 기본 verify에서 Web 검사 누락, mock 동시성 검증 한계 | M1-05, M3 | `package.json`, `.github/workflows/quality-gate.yml`, `src/usage-quota/usage-quota.service.spec.ts` |

새 검증은 날짜·작업 ID·명령·결과·환경·한계를 함께 기록하고, 과거 기록과 구분한다.

## 6. 변경 이력과 다음 작업

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M0 완료, M1을 대기 상태의 현재 착수 대상으로 지정. M0~M7 및 상태 표시 규칙 수립 | §5 기준선, 문서 링크·체크리스트 정합성 검사 | M1-01 한도 적용 경로 확정·연결 |
| 2026-09-23 | M4-01 완료, M4 진행 중 1/5 | 단위·계약 39개, 격리 PostgreSQL 17개 및 회귀 25개, 전체 verify Pass | M4-02 Console 홈 요약 지표 |
| 2026-09-23 | M4-02 완료, M4 진행 중 2/5 | Console Web 27개, 전체 verify Pass | M4-03 조직 감사 조회 API·화면 |
| 2026-09-28 | M4-03 완료, M4 진행 중 3/5 | 단위·HTTP 10개, Web 30개, 실 DB 5개, 전체 verify Pass | M4-04 알림 전달·상태 UX |
| 2026-09-28 | M4-04 완료, M4 진행 중 4/5 | 단위·HTTP 11개, Web 31개, 실 DB 5개, 전체 verify Pass | M4-05 최종 DB·브라우저 회귀 |

문서 작성 검증(2026-09-18): 변경 문서·지침 5개에서 상대 링크 57개와 고유 작업 ID
38개(M0 3개, M1~M7 35개), 단계별 완료 개수·현재 단계 표시를 확인했다.
문서 정합성 검사와 대상 문서 `git diff --check`는 Pass다. 애플리케이션 코드는 변경하지
않았으며 이번 문서 작업에서는 서버·Web 테스트를 재실행하지 않았다.

다음 실행 범위는 `M4-05` 임계치 동시 도달·중복·월 전환, 감사 격리와 홈 탐색·모바일·
키보드 사용 회귀 검증이다. M4는 진행 중(4/5)이다. 운영 DB 변경·배포는 수행하지 않았다.


### M1-01 적용 계약 및 검증 — 2026-09-18

대상은 인증된 앱의 사용자 답변 생성 호출이다. Console UI 경유 여부에 관계없이 적용한다.
한도 판단은 기존 UsageQuotaService를 공유하며 조직 월 요청 수, 조직·앱 월 토큰 한도를 검사한다.
한도가 모두 null이면 예약 없이 기존 호출을 허용한다. 0은 무제한으로 해석하지 않는다.

| 생성 경로 | 예약·토큰 추정 | operation key |
| --- | --- | --- |
| knowledge answers / rag-response | 기존 공통 답변 경로에서 한 번 예약, 검색 후 실제 생성 prompt·system 길이/4 올림 + 최대 출력 토큰 | requestId 또는 생성 UUID |
| conversation turns | 기존 replay 검사 후 한 번 예약, system·직렬화된 전체 messages 길이/4 올림 + 최대 출력 토큰 | DTO requestId |
| bedrock converse | 모델 설정 확인 후 한 번 예약, message·system 길이/4 올림 + maxTokens(기본 1024) | 호출별 생성 UUID |
| bedrock text-response | converse에 위임, 추가 예약 없음 | 내부 converse의 UUID |
| bedrock general-answers | 모델 설정 확인 후 한 번 예약, trim된 query·고정 system 길이/4 올림 + 500 | requestId 또는 생성 UUID |

조회·모델 목록·검색·업로드·색인의 embedding은 이 생성 한도 계약에서 제외한다.
지식 검색 결과 없음으로 생성하지 않는 응답은 기존대로 요청 로그 1건과 토큰 0으로 처리한다.
토큰 추정은 실제 tokenizer의 상한 보장이 아니다. 오차·초과·월 경계 및 operation 범위의
최종 정책·경계 시험은 M1-04에서 다룬다. Bedrock 일반 생성 API에는 응답 replay 계약을 추가하지 않았다.

Bedrock은 요청 admission 실패 시 모델·로그를 호출하지 않는다. 토큰 예약 실패나 호출 전 취소는
0으로 정산하여 활성 예약을 해제한다. 모델 호출 이후 실패 또는 로그 저장 실패는 UNCERTAIN을
유지하고 원래 오류를 전달한다. 로그 저장 성공 후 측정된 totalTokens로 정산하며 미측정은
0으로 확정하지 않고 UNCERTAIN을 유지한다. 정산 DB 오류는 서버 오류 로그를 남기며 기존 예약을
보존한다. SDK 내부 재시도에는 예약을 추가하지 않는다.

기존 지식·대화의 미측정 처리 차이, 로그와 활성 예약 사이의 중복 계수, 복구 경로는
M1-02~04에 남아 있다. 따라서 M1-01 연결 완료를 M1 전체 정합성 완료로 해석하지 않는다.

검증 환경: 2026-09-18 Windows 로컬 작업본(기존 미커밋 변경 포함), provider·Prisma mock.
- `npm run test:ci -- --testPathPatterns='bedrock|usage-quota|knowledge.contract|conversation|console'`: Pass, 19 suites / 147 tests. Bedrock 3경로의 단일 예약, 호출 순서, 요청/토큰 거절, provider/로그 실패, 미측정, 무제한 회귀 포함.
- `npm run typecheck`: 최초 선택 필드 content 오류 수정 후 Pass.
- `npm run lint:check`: 최초 테스트 mock 타입 오류 수정 후 Pass.
- 실제 AWS·PostgreSQL 동시성·브라우저·운영 검증 및 전체 build는 미실행. M1-05/M3에서 별도 수행한다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M1-01 완료, M1 진행 중 1/5. Bedrock 3경로 연결 및 계약 명시 | 위 M1-01 회귀·타입·린트 검사 | M1-02 요청 수 중복 계산 제거 |


### M1-02 요청 계수와 토큰 불확실성 분리 — 2026-09-18

원인: measuredUsage의 로그 COUNT와 RESERVED/UNCERTAIN의 reservedRequests를 합산하므로,
실패 로그 저장 후 UNCERTAIN 처리 또는 성공 로그 저장 후 정산 전/정산 실패에 요청이 중복 계수되었다.

변경: UsageQuotaService.recordUsage에서 admission과 동일한 조직 → 앱 advisory lock을 얻고,
reservedRequests를 1에서 0으로 바꾸는 작업과 실제 로그 INSERT를 하나의 트랜잭션으로 수행한다.
요청 수는 로그로 이전하고 reservedTokens와 state는 유지하여 토큰 불확실성과 분리한다.
로그 INSERT 실패 시 요청 수 이전도 롤백한다. 이미 이전한 예약의 중복 로그 저장은 409로 거절한다.
무제한(null 예약) 경로는 기존 로그 저장을 유지한다. 기존 스키마의 reservedRequests를 사용하며
이번 작업의 DB migration은 없다.

연결 범위: 지식 성공·검색 결과 없음·실패 로그, Bedrock 생성 로그, 일반 대화 로그와 Family RAG metric.
지식 실패 로그가 저장되면 UNCERTAIN 예약은 요청 0/토큰 예약 유지가 된다. 로그가 없는 실패는
요청 예약 1을 유지한다. 로그 저장 후 정산 실패 시에도 요청은 로그에서 한 번만 계수한다.

검증 환경: Windows 로컬 미커밋 작업본, provider·Prisma 및 트랜잭션/rollback mock.
- `npm run test:ci -- --testPathPatterns='bedrock|usage-quota|knowledge.contract|conversation|console'`: Pass, 19 suites / 158 tests.
- `npm run typecheck`: Pass.
- `npm run lint:check`: Pass.
- 변경 대상 `git diff --check` 및 신규 파일 포함 공백·문서 상태 검사: Pass.
- 검증 내용: RESERVED/UNCERTAIN의 로그 전환 후 요청 한도 경계, 미로그 예약 유지, 토큰 한도 유지,
  로그 실패 rollback·재시도, 중복 전환 거절, 전환 실패 시 로그 미실행, 동일 잠금 순서,
  정산 실패 후 중복 계수 방지, 무제한 경로 및 생성 서비스별 연결.

한계: 실제 PostgreSQL의 원자성·다중 연결 동시성·프로세스 중단 검증은 M1-05에서 수행한다.
이전 코드가 만든 기존 예약은 로그와의 연결 근거 없이 일괄 수정하지 않았다. 해당 기록의 조사·복구는
M1-03 범위다. 월 경계와 측정 토큰/예약 토큰의 보수적 중복 보유·미측정 정책은 M1-04에 남는다.
AWS·브라우저·운영 DB·배포 및 전체 build는 미실행이다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M1-02 완료, M1 진행 중 2/5. 로그·요청 예약 원자적 전환과 토큰 예약 분리 | 위 M1-02 회귀·타입·린트 검사 | M1-03 예약 조회·복구·멱등 재정산 |


### M1-03 예약 복구 경로 및 검증 — 2026-09-18

구현: `/admin/v1/usage-quota/reservations` 목록·상세·`:id/reconcile` API를 추가했다.
플랫폼 관리자만 접근하며 기본 목록은 15분 이상 갱신되지 않은 RESERVED/UNCERTAIN이다.
appcode·organizationId·periodKey·state·updatedBefore와 최대 200건 cursor 조회를 지원한다.

신규 로그 저장은 reservation의 usageLogSource/id와 같은 트랜잭션에서 기록한다.
복구는 실행 중지 확인·15분 유휴·expectedUpdatedAt 조건을 요구하며 조직 → 앱 잠금 안에서 처리한다.
- SETTLE_LOG: 원본 로그를 확인하여 정산. 기존 예약은 logSource/id를 명시할 수 있다.
- CONFIRM_USAGE: 로그 유실 후 확인된 요청 1건·실측 토큰을 복구 원장에 반영.
- RELEASE: 실행되지 않았고 로그가 없음이 확인된 예약 해제. 시간 경과만으로 자동 해제하지 않음.

복구 key와 본문 hash를 저장해 동일 요청 재시도 시 결과를 재사용한다. 다른 수치의 재정산,
중복 로그 참조·복구 key, 앱·월·가능한 requestId 불일치를 거절한다. 복구 결정 감사와 상태 변경은
하나의 트랜잭션이며 감사 저장 실패 시 롤백한다. 정상 정산도 같은 잠금을 사용하고 이미 확정된
토큰 수가 다르면 거절하여 늦은 작업이 복구 결과를 덮어쓰지 못하게 했다.

추가 migration: `20260918100000_add_usage_reservation_recovery`.
로그 참조·복구 계수·멱등 key/hash 및 unique/index/check를 추가한다. 기존 행 자동 복구는 하지 않는다.
월 한도 계산에는 복구 원장의 누락 요청/토큰만 합산한다. Console 사용량 UI·CSV 통합은 M2에 남는다.
운영 절차: [월 한도 예약 복구 runbook](HJ_AI_CONSOLE_USAGE_RECOVERY_RUNBOOK.md).

검증 환경: 2026-09-18 Windows 로컬 작업본(기존 미커밋 변경 포함).
- `npm run prisma:generate`: Pass.
- `npx prisma validate`: Pass. 실제 DB migration 실행을 의미하지 않음.
- `npm run build`: Pass (Prisma generate·Nest build·build stamp).
- `npm run typecheck`: Pass.
- `npm run lint:check`: 테스트 matcher의 unsafe assignment 2건을 한 차례 수정한 뒤 Pass.
- `npm run test:ci -- --testPathPatterns='bedrock|usage-quota|knowledge.contract|conversation|console|admin-api-key.guard'`: Pass, 22 suites / 213 tests.
- 변경 대상 `git diff --check`, 신규 파일 공백·문서 링크·M1 체크리스트 정합성: Pass.

검증 내용: provider·Prisma·트랜잭션/rollback mock과 Nest HTTP guard/DTO 경로.
로그 기반/유실/미실행 복구, 동일 요청 재시도, 상태 충돌, 근거 불일치, 미측정 보류,
감사 실패 rollback, 참조 저장 실패 rollback, 늦은 작업의 덮어쓰기 거절, 관리자 권한·입력·페이지 제한을 확인했다.
mock 동시 재시도 결과는 실제 PostgreSQL 다중 연결 검증을 대체하지 않는다.

미실행: 실제 DB migration 적용·unique 경합·COMMIT 응답 유실·프로세스 강제 중단 복구는 M1-05에 남는다.
월을 넘긴 로그 복구는 현재 거절하며 M1-04에서 월 귀속 정책을 확정한다. 실제 AWS·브라우저·운영 DB·배포도 미실행이다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M1-03 완료, M1 진행 중 3/5. 관리자 조회·복구·멱등 처리와 운영 절차 추가 | 위 M1-03 테스트·타입·린트·스키마·빌드 검사 | M1-04 월 경계·operation·토큰 정책 |


### M1-04 월·operation·토큰 정책 및 검증 — 2026-09-18

정책 기준: [월 한도 적용 정책](HJ_AI_CONSOLE_QUOTA_POLICY.md).
승인 시점은 조직/앱 잠금 획득 후 UTC 월로 정하고, 연결된 완료 로그와 복구 사용량은 예약의
periodKey·organizationId에 귀속한다. 원본 로그 시각은 보존한다. 연결된 월 넘김 로그의
SETTLE_LOG 복구는 허용하고, 수동 지정하는 미연결 과거 로그는 동일 월 확인을 유지한다.

operationScope를 도입해 앱·승인 월·경로·요청 ID별로 중복을 구분한다. 지식 별칭은 동일 scope,
대화는 tenant/session hash scope를 사용한다. Bedrock converse/text-response에도 correlation ID를
전달한다. legacy 원장의 기존 hash와 전환 월 중복 거절은 유지한다. tokensReservedAt은
0토큰의 중복 예약도 거절한다. 토큰 예약 전에 조직 변경을 확인한다.

토큰 추정은 최대 출력 + 입력 길이/4 올림의 admission estimate다. 오차 비율을 보장하지 않으며,
이미 승인된 요청의 실제 초과는 전량 반영하고 이후 한도 요청을 거절한다. 실측 로그와 동시에
추정 예약을 해제하여 정산 실패 구간에도 이중 계수하지 않는다. 지식·대화의 미측정 0 정산을
제거하고 불확실 예약을 유지한다. 생성 전 실패/근거 없음은 확인된 0으로 기록한다.
예약 없는 과거 미측정 로그는 토큰 한도 범위에서 503으로 차단한다. null은 무제한, 0은 제한이다.

추가 migration: `20260918110000_add_usage_reservation_policy`.
operation_scope·tokens_reserved_at을 추가하고 기존 양수 예약의 예약 시각을 채운다.
이미 연결된 실측 로그가 있는 활성 예약만 추정 토큰을 해제한다. 미연결·미측정 행은 유지한다.
운영 반영 전에 drain과 migration rehearsal을 해야 하며 이번 작업에서 DB 적용하지 않았다.

검증 환경: 2026-09-18 Windows 로컬 작업본(기존 미커밋 변경 포함), provider·Prisma·트랜잭션 mock.
- `npm run prisma:generate`, `npx prisma validate`: Pass.
- `npm run typecheck`: Pass.
- `npm run lint:check`: 테스트의 미대기 Promise 경고 1건 수정 후 경고 없이 Pass.
- `npm run build`: Pass.
- `npm run test:ci -- --testPathPatterns='bedrock|usage-quota|knowledge.contract|conversation|console|admin-api-key.guard'`: Pass, 23 suites / 254 tests.
- 변경 대상 `git diff --check`, 신규 파일 공백·링크·현재 단계/완료 개수 정합성 검사: Pass.

확인 범위: 잠금 대기 중 월 전환, 앱/월/scope별 중복·legacy 보호, 대화 tenant/session 분리,
정확한 토큰 경계·0 예약 중복·0/무제한·잘못된 토큰 값, 추정 대비 실측 감소/초과와 다음 요청,
실측 저장 뒤 정산 실패, 미측정 보유·과거 미측정 차단, 월 넘김 연결 로그 복구·기존 로그 거절,
서비스 경로별 미측정 처리와 correlation ID 전달. 월·조직 SQL 귀속은 구조 검사이며 실제 DB 실행이 아니다.

미실행: 실제 PostgreSQL migration/backfill·집계 SQL·UTC 경계·다중 연결/프로세스·복구 경합은
M1-05에서 검증한다. AWS·브라우저·운영 DB·배포는 미실행. 일반 Console 지표·CSV 동기화는 M2다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M1-04 완료, M1 진행 중 4/5. 월 귀속·operation namespace·토큰 경계 정책 구현 | 위 M1-04 회귀·타입·린트·스키마·빌드 검사 | M1-05 실제 PostgreSQL 동시성·집계·복구 검증 |

### M1-05 실제 PostgreSQL 통합 검증 — 2026-09-18

환경: Windows 로컬 PostgreSQL 18.4, 기존 미커밋 변경을 포함한 작업본.
`test/run-queue-http-e2e.mjs --usage-quota`가 localhost의 무작위 격리 DB를 생성하고
23개 migration을 적용했다. 종료 시 생성한 DB 삭제까지 확인했다. 원본 DB의 업무 데이터는 변경하지 않았다.
신규 의존성·운영 코드 변경 없이 `test/usage-quota-db.e2e-spec.ts`와
`test/fixtures/usage-quota-process.ts`에 재실행 가능한 검증을 추가했다.

- `npm run test:usage-quota-db`: Pass, 1 suite / 16 tests, 17.029초.
- `npm run test:ci -- --testPathPatterns='bedrock|usage-quota|knowledge.contract|conversation|console|admin-api-key.guard'`: Pass, 23 suites / 254 tests.
- `npm run typecheck`: 테스트 타입 선언의 자기 참조 오류 1건 수정 후 Pass.
- `npm run lint`, `npm run lint:check`: Pass.
- `git diff --check`: Pass (기존 작업본의 CRLF 안내만 출력).
- `npm run build`: Pass (Prisma generate·Nest build·build stamp).

실제 DB 확인 범위:
- 독립 Node 프로세스와 PostgreSQL 연결의 조직 요청 한도, 앱/조직 토큰 한도, 동일 operation 경합.
- 예약 직후·로그 트랜잭션 도중·로그 커밋 직후 프로세스 강제 종료와 복구.
- CHECK 제약을 이용한 로그·정산·감사 INSERT/UPDATE 실패와 트랜잭션 롤백.
- 별도 연결의 동일 복구 재시도, 중복 로그 참조/복구 key의 DB unique 제약, 늦은 정산 거절.
- 세 로그 소스와 복구 원장 집계, 미측정·0·무제한 정책, 월 넘김 로그와 조직 이동 귀속.
- 전체 migration 신규 적용 및 마지막 정책 migration의 backfill DML을 기존 행 fixture에 재실행.
- 실제 DB/Nest HTTP의 생성 성공·실패·429, 관리자 인증·복구·동일 요청 재시도.

제한: HTTP provider는 결정적 fake이며 실제 AWS 호출은 없다. 월 경계는 승인 월 clock seam과
명시적 로그 시각으로 재현했고 OS/DB 시계를 변경하지 않았다. 15분 유휴는 fixture 시각을 조정했다.
복구 응답을 버린 뒤 재시도하는 애플리케이션 수준의 응답 유실을 검증했으며, PostgreSQL COMMIT
네트워크 응답 패킷 유실 자체는 주입하지 않았다. backfill 검증은 운영 데이터 복제 rehearsal이 아니다.
브라우저·CI 연결은 M3, 운영 DB·실제 AWS·배포·운영 rehearsal은 후속 범위다.

M1-01~05 체크리스트와 완료 기준을 충족하여 M1 완료(5/5). 다음은 M2-01이며 아직 미착수다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M1-05 및 M1 완료, M2 대기 0/5로 전환 | 실제 PostgreSQL 16개·관련 회귀 254개·타입·린트·빌드 Pass | M2-01 공통 요청 로그 계약·성공/실패 기록 |


### M2-01~05 사용량·요청 로그·운영 지표 일치 — 2026-09-18

[Console M2 | 사용량·요청 로그·운영 지표 일치 | 완료 | 5/5]

계약: [Console 사용량·로그 계약](HJ_AI_CONSOLE_USAGE_CONTRACT.md).
- M2-01: Bedrock 생성·Family 대화 성공/실패의 요청 ID·endpoint·결과·오류 코드·모델 기록.
  Family 응답 검증 뒤 성공 기록, 생성 전 실패 0·생성 후 미측정 구분, 지식 UUID fallback과 저장 실패 예약 보존.
- M2-02: 공통 요청 SQL로 Family·복구 목록/상세/CSV 포함. 원본 시각·집계 시각·복구 근거 노출,
  과거 미계측 결과 unknown 유지, 사용량에서 조건별 로그로 이동.
- M2-03: UTC monthly API와 확정/예약/한도/잔여/사용률, 관리자 설정 주체·경로 명시.
  최근 기간과 이번 달 UI 분리. 조직 이동 앱의 타 조직 소계 비노출·잔여 한도 불확실 표시.
- M2-04: summary/일별/앱별/endpoint·model·status별 p50/p95, 공통 필터와 embedding 집계 범위 명시.
- M2-05: 실제 PostgreSQL 동일 fixture의 원본·summary·timeseries·breakdown·목록·상세·CSV·quota 대조.
  연결 복구 token 보충·유실 복구 1건·RELEASE 제외·승인 월/조직·미측정 정책 일치 확인.

신규 migration: `20260918120000_add_console_request_metadata`. 기존 로그 metadata는 null 보존.
환경: Windows 로컬 작업본, localhost PostgreSQL. 각 실행이 무작위 격리 DB를 생성하고
24개 migration을 적용한 뒤 해당 DB만 삭제했다. 운영/원본 DB 업무 데이터는 변경하지 않았다.

| 실행 명령 | 결과 | 범위·제약 |
| --- | --- | --- |
| `npm run prisma:generate` | Pass | 로컬 Prisma client 생성 |
| `npx prisma validate` | Pass | schema 검증 |
| `npm run typecheck` | Pass | 첫 실행 SDK optional 필드·비동기 union 콜백 타입 오류 수정 후 통과 |
| `npm run lint:check` | Pass | 서버·test TypeScript, 경고 없음 |
| `npm run build` | Pass | Prisma generate·Nest build·build stamp |
| `npm run test:console-usage-db` | Pass — 1 suite / 8 tests | 실 DB 집계·복구·조직 이동·월 경계·cursor·CSV 5,000행·한도 |
| `npm run test:usage-quota-db` | Pass — 1 suite / 16 tests | M1 다중 연결/프로세스·복구·HTTP 회귀. 실패 로그 추가에 맞춰 SETTLE_LOG 복구 계약 검사 |
| `npm run test:ci -- --testPathPatterns='bedrock|usage-quota|knowledge.contract|conversation|console|operational-error-code|admin-api-key.guard'` | Pass — 24 suites / 268 tests | provider/Prisma mock 및 Nest HTTP guard·DTO 회귀 |
| `npm run test:console-web` | Pass — 24 tests | BFF/API·기존 소스 계약 및 실제 markup 함수 VM 렌더·필터/링크·미측정/0 표시 |
| `git diff --check` 및 문서 정합성 검사 | Pass | 신규 파일 공백, 관련 문서 4개 상대 링크 20개, M2 5/5·M3 대기·전체 10/35 일치 |

실 DB 대조 표본: 요청 5, 확인 token 80, token 측정 4, 성공 2/실패 1/결과 미측정 2,
성공률 66.67%, p50 250ms/p95 385ms. 연결 복구 40 token은 원본 1건에만 반영하고
유실 복구 10 token은 결과 미측정 1건으로 반영했다. 원본·CSV·quota와 동일했다.
추가로 월 경계 뒤 완료된 로그의 승인 월 귀속, 현재 소유 앱이 없는 이전 조직의 조회,
타 조직 직접 ID 거부, 동일 시각 소스 혼합 cursor, 5,001건 중 CSV 5,000건 제한을 확인했다.

미실행: 실제 AWS·브라우저 E2E·운영 DB migration/rehearsal·배포. Web VM 렌더는 브라우저
레이아웃·사용자 여정 검증을 대체하지 않는다. M3에서 CI 연결·브라우저/HTTP 통합을 진행한다.
Embedding은 Family operation만 측정하며 일반 지식 embedding은 미측정으로 명시했다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-18 | M2-01~05 완료(5/5), M3 대기(0/5)로 전환 | 위 실 DB 8+16개, 서버 268개, Web 24개·타입·린트·schema·빌드 Pass | M3-01 Console Web 기본 verify/CI 연결 |


### M3-01 Console Web 품질 검사 연결 — 2026-09-21

[Console M3 | DB·브라우저 통합 검증과 CI | 진행 중 | 1/5]

원인: CI가 실행하는 루트 `verify`에 Console Web이 빠져 Web 실패가 품질 검사를 막지 못했다.
`package.json`의 verify를 build → typecheck → lint:check → test:ci → test:console-web →
test:demo 순서로 연결했다. `.github/workflows/quality-gate.yml`은 기존 verify 실행을 유지하고
`test:console-web-gate` 실패 전파 검사 단계를 추가했다. 신규 의존성은 없다.

`scripts/check-console-web-gate.mjs`는 저장소 내부 `work/console-web-gate-*` 임시 복사본에서
실제 verify 명령·Console Web 테스트를 사용하고 Web 실패 1건을 주입한다. 이 음성 검증의
build/typecheck/lint/서버 단계만 성공 stub으로 대체하며, verify의 종료 코드 1과 이후 demo
단계 미실행을 확인한다. 임시 디렉터리는 종료 시 삭제한다. 원본 테스트는 변경하지 않는다.

환경: Windows 로컬, Node v24.15.0 / npm 11.12.1. 기준 HEAD
`e3a6bc80efa569c9d58340ba373e72d0fe3737c9`에 기존 M2 미커밋 변경과 이번 M3-01을 포함한 작업본.

| 실행 명령 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run verify` | Pass | build·typecheck·lint:check, 서버 62 suites/497 tests, Console Web 24 tests, demo 56 tests |
| `npm run test:console-web-gate` | Pass | 주입한 Web 실패가 verify exit 1로 전파, 후속 단계 중단, 임시 복사본 삭제 확인 |
| `git diff --check` 및 문서 정합성 검사 | Pass | 현재 단계·체크리스트·11/35·관련 문서 링크 검사 |

위 결과는 로컬 실행이다. GitHub Actions 원격 실행·push·실제 DB·브라우저 E2E·AWS·운영 배포는
이번 M3-01에서 수행하지 않았다. 전체 verify 통과만으로 M3-02~05를 완료 처리하지 않는다.
다음은 M3-02이며 M3-02~05는 미착수다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-21 | M3-01 완료, M3 진행 중 1/5 | 전체 verify 및 Web 실패 전파 검증 Pass | M3-02 조직·역할별 실제 DB/HTTP 검증 |

### M3-02 조직·permission별 실제 DB/HTTP 검증 — 2026-09-23

[Console M3 | DB·브라우저 통합 검증과 CI | 진행 중 | 2/5]

`test:console-access-db`를 추가했다. 기존 격리 DB runner가 localhost의 무작위 DB를 생성하고
24개 migration을 적용한 뒤 두 조직과 Admin·Developer·Knowledge Manager·Viewer permission
fixture를 구성한다. Nest HTTP controller·guard와 실제 Prisma service를 연결해 앱·credential·
사용량·요청 로그의 허용/거부 및 조직 격리를 검사하고 종료 시 해당 DB만 삭제한다.

검증 범위:

- 무인증 401, 비활성 identity·조직·membership 403, permission 누락 403.
- 조직별 앱 목록 격리, 타 조직 appId 404, HTTP로 생성한 앱의 organization·actor ownership 저장.
- credential 읽기·발급 permission 분리, 타 조직 발급 404, 원문 key 일회성 응답과 DB hash 저장,
  목록·DB의 원문 비노출.
- 조직별 사용량 합계와 요청 로그 격리, Viewer 로그 접근 403, 타 조직 logId 직접 접근 404,
  질문 원문 비노출.
- production에서 development fixture 플래그를 켜면 환경 검증 단계에서 기동을 거부하고,
  정상 production 설정에서는 Console 무인증 요청 401 및 fixture identity·조직 DB 미생성.

| 실행 명령 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run test:console-access-db` | Pass — 1 suite / 4 tests, 24 migrations | 실제 PostgreSQL·Nest HTTP·Prisma, 임시 DB 삭제 확인 |
| `npm run test:ci -- --testPathPatterns="console\|usage-quota\|operational-error-code"` | Pass — 19 suites / 174 tests | Console·한도·오류 계약 회귀 |
| `npm run typecheck` | Pass | 신규 통합 시험 포함 TypeScript 검사 |
| `npm run lint:check` | Pass | 서버·test TypeScript, 경고 없음 |
| `npm run verify` | Pass | build·typecheck·lint, 서버 62 suites/497 tests, Console Web 24, demo 56 |

초기 검증에서 production 환경값의 모듈 로딩 시점 차이와 production fixture 설정의 의도된
기동 거부를 테스트가 잘못 기대한 문제를 수정했다. 이후 3/4 통과 실행에서 요청 로그 응답의
`app.appcode` 구조에 assertion을 맞춘 뒤 최종 4/4 통과했다. 애플리케이션 운영 코드는 변경하지 않았다.

제약: 역할명에서 permission으로 변환하는 HJ-Works adapter는 M6 범위이므로 이번 시험은 동일한
`ConsoleIdentityContext` port에 역할별 permission을 주입했다. 브라우저·실제 AWS·운영 DB·배포와
GitHub Actions 원격 실행은 미실행이다. M3-03에서 브라우저 사용자 여정과 실제 API 호출을 검증한다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-23 | M3-02 완료, M3 진행 중 2/5 | 실제 PostgreSQL/HTTP 4개, 회귀 174개, 전체 verify Pass | M3-03 앱·키·API·사용량·로그·회전/폐기 브라우저 E2E |

### M3-03 실제 브라우저 사용자 여정 검증 — 2026-09-23

[Console M3 | DB·브라우저 통합 검증과 CI | 진행 중 | 3/5]

`start:console-browser-fixture`를 추가했다. localhost PostgreSQL에 무작위 이름의 격리 DB를
생성해 24개 migration을 적용하고, development fixture identity를 사용하는 AI Server와
Console Web을 기동한다. 종료 시 자식 프로세스를 정리하고 정규식으로 확인한 해당 DB만 삭제한다.

Playwright CLI의 headed Chromium에서 다음 사용자 여정을 실행했다.

- 앱 생성 → 90일 Key 최초 발급 → Playground에서 실제 `/knowledge/answers` 호출.
- 사용량 1건과 요청 로그·상세의 동일 Request ID, endpoint, 지연, 원문 비노출 확인.
- 5분 grace로 Key 회전 → 이전 Key 200, 신규 Key 200 확인 → 이전 Key 폐기.
- 폐기한 이전 Key 401, 현재 Key 200 확인. 성공 호출 4건만 사용량·요청 로그에 집계됨.
- localStorage와 sessionStorage가 모두 비어 있고, Key 입력값은 페이지 전환 후 제거됨을 확인.

지식 자료가 없는 격리 DB이므로 네 성공 호출은 검색 후 `insufficient_evidence`, token 0으로
종료됐다. 실제 인증·검색·로그·집계 경로를 사용했으며 provider mock이나 대체 provider를
주입하지 않았다. 검색 결과가 없어 Bedrock 생성 provider 자체는 호출되지 않았고 상세 metadata의
`modelInvoked: false`, `generationMs: 0`으로 확인했다.

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run start:console-browser-fixture` + Playwright CLI | Pass | headed Chromium, 격리 PostgreSQL/AI Server/Console Web; 앱·Key·실제 API·사용량·로그·회전/grace/폐기 |
| 브라우저 network·console | Pass | 성공 호출 4회 200, 폐기 Key 1회 의도된 401; 그 외 오류·경고 없음 |
| 브라우저 storage | Pass | localStorage/sessionStorage 항목 없음 |
| `node --check scripts/run-console-browser-fixture.mjs` 및 fixture 재기동·종료 | Pass | 종료 경고 없음, 임시 DB 삭제 확인 |
| `npm run test:console-access-db` | Pass — 1 suite / 4 tests | 24 migrations, 임시 DB 삭제 확인 |
| `npm run typecheck`, `npm run lint:check` | Pass | 현재 작업본 |
| `npm run test:console-web` | Pass — 24 tests | Web/BFF 회귀 |
| `npm run verify` | Pass | build·typecheck·lint, 서버 62 suites/497 tests, Console Web 24, demo 56 |

브라우저 최종 사용량 화면은 `output/playwright/m3-03/m3-03-final-usage.png`에 남겼다. Key가
포함될 수 있는 임시 snapshot·trace는 검증 후 삭제했다. 실제 AWS provider·운영 DB·원격 CI·
운영 배포는 실행하지 않았다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-23 | M3-03 완료, M3 진행 중 3/5 | headed 브라우저 대표 여정, 성공 4회·폐기 Key 401, 저장소 비보관, 전체 verify Pass | M3-04 격리 회귀 환경·CI/별도 실행 경로 |

### M3-04 M1/M2 격리 회귀 실행 경로와 CI 연결 — 2026-09-23

[Console M3 | DB·브라우저 통합 검증과 CI | 진행 중 | 4/5]

기존 `usage-quota-db.e2e-spec.ts` 16개와 `console-usage-db.e2e-spec.ts` 8개를 하나의
`test:console-regression-db` 명령으로 연결했다. runner는 localhost PostgreSQL에 무작위 DB를
한 번 만들고 24개 migration을 적용한 뒤 두 suite를 직렬 실행하며, 성공·실패와 관계없이
이번 실행이 만든 DB만 강제 연결 종료 후 삭제한다.

이 경로가 다루는 M1/M2 회귀는 다음과 같다.

- 조직·앱 월 한도 경계와 0·무제한·미측정 정책, 독립 프로세스 동시 요청 한 건만 승인.
- 동일 operation 중복 방지, 실제 로그 INSERT·정산·감사 INSERT 실패 rollback과 멱등 복구.
- 원본 ledger와 summary·timeseries·breakdown·로그·상세·CSV·월 한도 대조.
- 동일 시각 다중 소스 cursor의 누락·중복 없는 페이지 이동과 잘못된 cursor 거부.
- CSV 5,000행 상한과 `truncated: true`, 5,001개 header 포함 행 수 검증.

Quality Gate에는 독립 `console-db-regression` job을 추가했다. Node.js 24와 digest를 고정한
`pgvector/pgvector:pg16` service를 사용하며 DB 준비 상태를 확인한 후 위 명령을 실행한다.
일반 단위 품질 job과 분리해 PostgreSQL service 실패와 Console DB 회귀 실패를 명확히 구분한다.

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run test:console-regression-db` 2회 | Pass — 매회 2 suites / 24 tests | 로컬 PostgreSQL, 매회 24 migrations·서로 다른 임시 DB·삭제 확인 |
| CI와 동일 digest의 `pgvector/pgvector:pg16` Docker service + 전용 명령 | Pass — 2 suites / 24 tests | host port 55432에서 service image·health·migration·정리 검증 |
| `npx prettier --check package.json test/run-queue-http-e2e.mjs .github/workflows/quality-gate.yml` | Pass | 신규 명령·runner·workflow 형식 |
| `git diff --check` | Pass | 변경 공백 검사 |

CI workflow 정의와 service image는 로컬에서 대등하게 검증했지만 GitHub Actions 원격 실행은
아직 수행하지 않았다. 실제 AWS provider·운영 DB·배포도 실행하지 않았다. M3-05에서 현재
작업본의 전체 품질 검사와 환경·revision 기준을 최종 기록한다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-23 | M3-04 완료, M3 진행 중 4/5 | 격리 회귀 24개 반복·CI service image 검증 Pass | M3-05 전체 품질 검사·작업본 기준 기록 |

### M3-05 전체 품질 검사와 작업본 기준 기록 — 2026-09-23

[Console M3 | DB·브라우저 통합 검증과 CI | 완료 | 5/5]

최종 검증 기준은 Git branch `codex/demo-api-validation`, base HEAD
`08a210e727ffa585da037bea11231413ee1524ff`에 아래 M3 변경을 포함한 미커밋 작업본이다.
따라서 특정 배포 revision이나 원격 branch의 검증 결과로 해석하지 않는다.

- 수정: `.github/workflows/quality-gate.yml`, `package.json`, `test/run-queue-http-e2e.mjs`,
  마일스톤·진행·구축 계획·시험 전략 문서.
- 신규: `scripts/run-console-browser-fixture.mjs`, `test/console-access-db.e2e-spec.ts`.
- 실행 환경: Windows 11 Home 10.0.26200 x64, Node.js 24.15.0, npm 11.12.1,
  Prisma/Client 7.9.1, TypeScript 5.9.3, PostgreSQL 18.4, Docker 29.8.0.
- CI service 기준: digest 고정 `pgvector/pgvector:pg16`
  (`sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`).

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run verify` 단독 재실행 | Pass | build·typecheck·lint, 서버 62 suites/497 tests, Console Web 24, demo 56 |
| `npm run test:console-regression-db` | Pass — 2 suites / 24 tests | 한도·동시성·중복·실패 복구·집계·cursor·CSV, 24 migrations·임시 DB 삭제 |
| `npm run test:console-access-db` | Pass — 1 suite / 4 tests | 조직·permission·production fixture 차단, 24 migrations·임시 DB 삭제 |
| `npm run test:console-web-gate` | Pass | Web 실패가 verify exit 1로 전파되고 후속 검사 중단 |
| M3-03 Playwright CLI 대표 여정 | Pass | 실제 브라우저 앱·Key·API·사용량·로그·grace·폐기; 해당 기록 재사용, 이번 M3-05에서 미재실행 |
| `npx prettier --check ...`, `git diff --check` | Pass | 실행 경로·workflow 형식과 변경 공백 |

첫 최종 실행에서 `verify`, 두 DB suite와 `test:console-web-gate`를 동시에 실행했다. Web gate가
별도 임시 작업본에서 자체 `verify`를 수행하는 동안 주 `verify`의 Jest가 상세 실패 로그 없이
exit 1로 종료됐다. DB 24개·4개와 Web gate는 통과했다. 동일 작업본에서 `npm run verify`를
단독 재실행해 전체 통과했으므로 기능 실패가 아니라 검증 프로세스 병렬 간섭으로 판정했다.
향후 최종 품질 검사는 Web gate와 동시 실행하지 않는다.

M3 완료 기준인 사용자 행동·실 DB 결과 검증, 자동화/별도 통합 범위 구분, 실행 증거 기록을
모두 충족했다. 원격 GitHub Actions, 실제 AWS provider, 운영 DB migration, 운영 배포는
실행하지 않았으며 이는 M7 운영 준비·공개 범위다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-23 | M3-05 및 M3 완료(5/5), M4 대기(0/5) | 전체 verify, 실 DB 24+4개, Web gate, M3-03 브라우저 증거 | M4-01 월 사용량 임계치 event·중복 방지 |

### M4-01 월 사용량 임계치 event와 중복 방지 — 2026-09-23

[Console M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 1/5]

조직 월 요청 수와 조직 월 token의 committed 사용량이 설정 한도의 70%, 90%, 100%에
도달하면 `console_usage_threshold_event`를 요청 admission/token 예약과 같은 transaction에
저장한다. 조직·UTC 승인 월·REQUESTS/TOKENS 지표·임계치 unique constraint와
`skipDuplicates`를 함께 사용해 독립 프로세스 경합에서도 동일 event가 한 번만 남는다.

event 저장 실패는 사용량 변경도 rollback하여 동일 operation 재시도가 안전하다. 요청은 admission
UTC 월, token은 원래 예약 승인 월에 귀속한다. null 무제한과 0 한도는 event를 만들지 않으며,
한도 설정 변경만으로 과거 사용량을 backfill하지 않는다. 한 번의 사용이 여러 임계치를 넘으면
도달한 event를 모두 저장한다. 외부 채널·수신자·전달 재시도는 M4-04 범위이며 이번 작업에서는
메시지를 발송하지 않았다. 상세 정책은 `HJ_AI_CONSOLE_USAGE_CONTRACT.md` §4에 기록했다.

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| `npm run test:ci -- --runTestsByPath src/usage-quota/usage-quota.service.spec.ts src/console/console-usage-threshold-migration.contract.spec.ts` | Pass — 2 suites / 39 tests | 도달·중복·rollback/재시도와 additive migration 계약 |
| `npm run test:usage-quota-db` | Pass — 1 suite / 17 tests | 25 migrations, 요청·token 70/90/100%, 독립 프로세스 중복 방지, 임시 DB 삭제 |
| `npm run test:console-regression-db` | Pass — 2 suites / 25 tests | M1/M2 회귀와 신규 임계치 event, 25 migrations·임시 DB 삭제 |
| `npm run verify` | Pass | build·typecheck·lint, 서버 63 suites/501 tests, Console Web 24, demo 56 |
| `npx prisma format` | Pass | Prisma schema 형식 |

신규 migration은 격리 PostgreSQL에만 적용했다. 운영 DB migration, 실제 알림 전송,
원격 CI·AWS·운영 배포는 실행하지 않았다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-23 | M4-01 완료, M4 진행 중 1/5 | 임계치 event·transaction rollback·DB unique, 단위/계약 39개·실 DB 17/25개·전체 verify Pass | M4-02 Console 홈 요약 지표 |

### M4-02 Console 홈 요약 — 2026-09-23

[Console M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 2/5]

`/console`을 앱 목록의 별칭이 아닌 독립 홈 route로 연결했다. 새 집계 API를 만들지 않고 기존
조직 범위 `usage/monthly`, 앱 목록, 당월 실패 요청 로그를 병렬 조회한다. 홈에는 당월 요청·
token committed(확정+예약), 잔여 한도, 결과 측정 기준 성공률, 지연 측정 기준 p95를 표시한다.

최근 오류는 원문 없이 최대 5건과 전체 실패 로그 링크를 제공한다. 현재 API Key 만료일은 가까운
순으로 최대 5개를 보여주며 30일 이하는 주의 상태로 표시하고 Credential 화면으로 연결한다.
지식 색인 실패는 M5의 `knowledge-index-failures-v1` 계약(`failedJobs`, `lastFailureAt`,
`affectedApps`)을 명시하고 연결 전에는 0이 아닌 미측정으로 표시한다. 모바일에서는 네 요약 카드와
두 운영 패널을 한 열로 재배치한다.

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| `node --check console-web/public/app.js` | Pass | 브라우저 모듈 구문 |
| `npm run test:console-web` | Pass — 27 tests | 홈 실 markup 렌더, 빈 값·미측정·escape, route/API 연결 포함 |
| `npm run typecheck`, `npm run lint:check` | Pass | 서버 TypeScript 회귀 |
| `npm run verify` | Pass | build·typecheck·lint, 서버 63 suites/501 tests, Console Web 27, demo 56 |
| `git diff --check` | Pass | 변경 공백 검사 |

M4-02에서는 실제 브라우저·운영 DB·원격 CI·AWS·운영 배포를 실행하지 않았다. 홈 탐색·모바일·
키보드 실제 브라우저 회귀는 M4-05 완료 기준에 포함한다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-23 | M4-02 완료, M4 진행 중 2/5 | 홈 route·당월 지표·최근 오류·Key 만료·M5 색인 계약, Web 27개·전체 verify Pass | M4-03 조직 감사 조회 API·화면 |

### M4-03 조직 범위 활동·보안 감사 조회 — 2026-09-28

[Console M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 3/5]

`GET /console-api/v1/audit-events`와 `/console/audit` 화면을 추가했다. API는 `audit:read`를
요구하며 organization ID를 query로 받지 않고 인증 identity에서 강제한다. 최근 7/30/90일,
event type, 조직 소유 앱, Works 사용자 필터와 기본 25/최대 100건의 `createdAt + id` cursor
pagination을 제공한다.

응답은 event·앱·request·불변 행위자 식별자와 허용된 primitive 상세만 반환한다. session hash,
credential 원문/hash, recovery key, 임의 metadata와 요청·응답 원문은 projection에서 제외한다.
화면은 동일 필터와 더 보기를 지원하고 앱·Key 관리 활동을 사람이 읽을 수 있는 이름으로 표시한다.

감사 저장 실패 정책은 [감사 계약](HJ_AI_CONSOLE_AUDIT_CONTRACT.md)에 확정했다. Console 앱·Key
변경의 사후 활동 감사는 best-effort로 오류를 기록하고 이미 commit된 변경을 실패로 뒤집지 않는다.
한도 복구처럼 감사 event 자체가 결정 원장인 작업은 기존대로 업무 변경과 같은 transaction에서
fail-closed한다. 저장 오류 운영 경보는 M7 관측성 범위다.

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| 감사 service/controller와 저장 실패 단위 시험 | Pass — 3 suites / 10 tests | 조직 강제, filter/cursor, allowlist, 권한, best-effort false 반환 |
| `npm run test:console-access-db` | Pass — 1 suite / 5 tests | 실제 PostgreSQL 두 조직 격리·권한·session hash/metadata 비노출, 25 migrations·임시 DB 삭제 |
| `npm run test:console-web` | Pass — 30 tests | API 직렬화, 안전한 markup, 메뉴·route·pagination 연결 |
| `npm run typecheck`, `npm run lint:check` | Pass | TypeScript·lint |
| `npm run verify` | Pass | build·typecheck·lint, 서버 65 suites/507 tests, Console Web 30, demo 56 |
| `git diff --check` | Pass | 변경 공백 검사 |

첫 실 DB 실행은 공통 interceptor의 `awsRequest` 응답 확장을 정확 일치 assertion이 고려하지 않아
1건 실패했다. 조직 격리 결과는 정상이었고 핵심 필드 match로 시험을 수정한 뒤 5/5 통과했다.
새 migration은 없으며 실제 브라우저·운영 DB·원격 CI·AWS·운영 배포는 실행하지 않았다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-28 | M4-03 완료, M4 진행 중 3/5 | 감사 API·화면·실패 정책, 단위/HTTP 10개·실 DB 5개·Web 30개·전체 verify Pass | M4-04 알림 전달·상태 UX |

### M4-04 내부 알림함 전달 정책과 상태 UX — 2026-09-28

[Console M4 | 홈·임계치 알림·감사 조회 | 진행 중 | 4/5]

`GET /console-api/v1/usage/alerts`를 추가해 인증 identity의 조직과 현재 UTC 월에 속한 임계치
event만 조회한다. 채널은 외부 전송이 없는 내장 `console-inbox`, 수신자는 활성 membership과
`usage:read` 권한을 통과한 사용자다. 화면은 읽기 전용이며 동일 event의 안정된 ID와 DB unique
key를 사용해 새 메시지를 만들지 않고 재조회한다. 따라서 재전송 정책은 `idempotent-refetch`이고
별도 SMTP·메신저 계정, 주소 원문, delivery worker를 추가하지 않았다.

홈에 70/90/100% 알림 목록과 빈 상태를 연결했다. 100%는 위험, 90%는 주의, 70%는 안내로
표시한다. 기존 월 카드의 0 한도·무제한·미측정 구분과 함께 읽기 전용 표식을 명시했다.
월 사용량은 홈의 필수 기준 데이터로 유지하되 앱·오류·알림 조회는 `Promise.allSettled`로
분리해 한 부가 API 오류가 전체 홈을 가리지 않고 해당 패널에 재시도 상태만 표시한다.

| 실행 명령·검증 | 결과 | 범위·한계 |
| --- | --- | --- |
| usage service/controller 단위·HTTP 시험 | Pass — 2 suites / 11 tests | 현재 조직·UTC 월, severity·채널 계약, `usage:read` 허용/거부 |
| `npm run test:console-access-db` | Pass — 1 suite / 5 tests | 실제 PostgreSQL 두 조직 event 격리·Viewer 허용·무권한 403, 25 migrations·임시 DB 삭제 |
| `npm run test:console-web` | Pass — 31 tests | 알림·빈 상태·읽기 전용·부분 오류·0/무제한/미측정 실제 markup 및 API 경로 |
| `npm run verify` | Pass | build·typecheck·lint, 서버 65 suites/509 tests, Console Web 31, demo 56 |
| `git diff --check` | Pass | 변경 공백 검사 |

외부 메시지는 발송하지 않았다. 실제 브라우저 모바일·키보드 탐색, 임계치 다중 프로세스와
월 전환 최종 회귀는 M4-05에서 수행한다. 운영 DB·원격 CI·AWS·운영 배포도 실행하지 않았다.

| 날짜 | 변경 | 근거·검증 | 다음 작업 |
| --- | --- | --- | --- |
| 2026-09-28 | M4-04 완료, M4 진행 중 4/5 | 내부 알림함 API·홈 상태 UX, 단위/HTTP 11개·실 DB 5개·Web 31개·전체 verify Pass | M4-05 최종 DB·브라우저 회귀 |
