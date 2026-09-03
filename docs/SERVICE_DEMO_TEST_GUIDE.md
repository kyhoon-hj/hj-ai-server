# 서비스 데모 로컬 테스트 가이드

- 검증일: 2026-08-31
- 대상: AI Server, 검증 데모, HJ Mart Assist 서비스 데모

## 현재 접속 주소

| 구성요소 | 주소 | 확인 기준 |
| --- | --- | --- |
| AI Server readiness | http://127.0.0.1:11000/health/ready | HTTP 200, database/storage/bedrock 정상 |
| 검증 데모 | http://127.0.0.1:11001 | 검증 환경 구성 및 API 시나리오 실행 |
| 서비스 데모 채팅 | http://127.0.0.1:11002/chat | STORE_A/STORE_B 고객 상담 |
| 매장 관리자 지식관리 | http://127.0.0.1:11002/knowledge | 목록·업로드·인덱싱·보관 |

현재 작업 세션에서는 세 서버가 모두 실행 중이다. 작업 세션이나 서버 프로세스를 종료한 뒤에는 아래 순서로 다시 시작한다.

## 재시작 순서

각 명령은 별도 PowerShell 창에서 실행한다.

1. 저장소 루트에서 AI Server를 시작한다.

   ```powershell
   npm run start:prod
   ```

2. `demo/`에서 검증 데모를 시작한다.

   ```powershell
   node --env-file=../.env server.mjs
   ```

3. 처음 실행하거나 fixture를 초기화해야 하면 검증 데모에서 `검증 환경 구성`을 실행한다. API로 실행할 때는 다음 요청을 사용한다.

   ```powershell
   Invoke-RestMethod -Uri 'http://127.0.0.1:11001/api/demo/setup' -Method Post -ContentType 'application/json' -Body '{"confirmSetup":true}'
   ```

4. `service-demo/`에서 연결형 개발 서버를 시작한다.

   ```powershell
   npm run dev:connected
   ```

`dev:connected`는 STORE_A/STORE_B 서버 전용 appkey를 자동으로 회전해 git에서 제외된 `.dev.vars`에 저장한다. 키 원문을 브라우저나 콘솔에 출력하지 않는다.

## 수동 데모 시나리오

브라우저에서 서비스 데모 채팅을 열고 매장과 질문을 아래처럼 선택한다.

| 번호 | 매장 | 질문 | 기대 결과 |
| --- | --- | --- | --- |
| 1 | STORE_A | `운영시간은?` | 오전 10시~오후 10시, `store-a-policy.md` 근거 |
| 2 | STORE_A | `멀티탭 3구 2m는 어디에 있고 재고와 가격은 얼마인가요?` | 1층 A-04, 재고 18개, 5,000원, `store-a-products.csv` 근거 |
| 3 | STORE_A | `환불정책은` | 일반 상품 7일 이내와 전자제품 14일 안내, 정책·반품 가이드 근거 |
| 4 | STORE_A | `품절된 고양이 장난감은 다음 주에 재입고되나요?` | 답변 불가, 근거 없음, 상담원 검토 요청 가능 |
| 5 | STORE_B | `STORE_B에서 미사용 상품은 구매 후 며칠 이내 교환할 수 있나요?` | 14일 이내, `store-b-policy.md` 근거 |

## tenant 격리 확인

1. STORE_A에서 질문한 뒤 STORE_B로 전환했을 때 대화가 초기화되는지 확인한다.
2. STORE_B 답변의 근거에 `store-a-*` 파일이 나타나지 않는지 확인한다.
3. STORE_A 문맥에서 STORE_B 정책을 질문해도 `store-b-policy.md`가 노출되지 않는지 확인한다.

## 합격 체크리스트

- [x] `/api/health`가 `ready`를 반환한다.
- [x] 질문 전송 중 로딩 상태가 표시되고 중복 전송이 막힌다.
- [x] 답변에 파일명·관련도 등 허용된 근거만 표시된다.
- [x] appkey, S3 key, 원문 content, 내부 metadata가 브라우저 응답에 없다.
- [x] 자료에 없는 질문은 추측하지 않고 상담원 검토를 안내한다.
- [x] 매장 전환 시 다른 tenant의 근거가 섞이지 않는다.
- [x] 오류 화면에 correlation ID가 표시된다.

화면 테스트는 2026-08-31 사용자 확인으로 전체 PASS 처리했습니다.

## 다음 화면 테스트 — 매장 관리자 지식관리

- [x] 홈에서 `매장 관리자`를 선택하고 `지식 관리 시작`으로 이동한다.
- [x] STORE_A와 STORE_B 전환 시 각 매장의 문서만 표시된다.
- [x] 지원 문서를 선택해 업로드·인덱싱 완료 안내를 확인한다.
- [x] 새 문서가 `검색 가능` 상태와 chunk 수로 표시된다.
- [x] 재인덱싱 완료 안내를 확인한다.
- [x] 새 버전의 고객 답변을 확인한 뒤 이전 버전을 보관한다.
- [x] 보관한 문서가 활성 목록에서 제거되는지 확인한다.

관리자 지식관리 화면 테스트는 2026-08-31 사용자 확인으로 전체 PASS 처리했습니다.

## 다음 화면 테스트 — 상담원 역할 경계

- [x] 홈에서 `고객 상담`을 선택하면 버튼이 `검토함 열기`로 바뀐다.
- [x] `검토함 열기`가 고객 채팅이 아닌 `/agent`로 이동한다.
- [x] 로컬 상담원 권한 확인 후 `상담원 전용 접근 확인`이 표시된다.
- [x] 화면에 로그인 이메일·인증 토큰·관리자 키가 표시되지 않는다.
- [x] 상담원 검토함에 영구 문의가 아직 연결되지 않았다는 다음 단계 안내가 표시된다.

상담원 역할 경계 화면 테스트는 2026-08-31 사용자 확인으로 전체 PASS 처리했습니다.

## 2026-08-31 실행 결과

- readiness와 `/chat`: HTTP 200
- 상품 재고, STORE_A 환불, STORE_B 교환: 답변과 기대 근거 확인
- 미등록 재입고 일정: `answerable=false`, source 없음 확인
- STORE_A 문맥의 STORE_B 질문: STORE_B source 비노출 확인
- 짧은 질문 `운영시간은?`: 오전 10시~오후 10시와 정책 source 확인
- 미등록 전화번호·주차·재입고 질문: strict no-answer 유지 확인
- 서비스 데모 자동 검증: 15 files, 47 tests PASS
- typecheck, lint, production build: PASS
- 비인증 상담원 API 403, 상담원 세션·권한 확인 200, 화면 응답 secret 0건
- 개인정보 포함 질문 400·원문 비반사, 일반 지식 질문 200·근거 2건
