# 데모 개발 계획

전체 실행 순서, 서버 개선 작업 ID와 단계별 승인 기준은
[`docs/DEMO_AI_SERVER_INTEGRATED_ROADMAP.md`](../../docs/DEMO_AI_SERVER_INTEGRATED_ROADMAP.md)를 기준으로 합니다.

## 목적

이 데모의 주목적은 업무 화면 시연이 아니라 HJ AI Server를 실사용 수준으로 고도화하기 위한 반복 가능한 시험 환경을 제공하는 것입니다. AI Server를 블랙박스 HTTP API로 호출해 기능, 계약, 보안 경계, RAG 품질과 성능을 확인합니다.

## 설계 원칙

1. AI Server와 별도 프로세스로 실행한다.
2. appkey는 브라우저나 localStorage에 저장하지 않는다.
3. DB를 직접 조회해 성공을 판정하지 않는다.
4. 모든 기능을 operation catalog에서 호출할 수 있게 한다.
5. 계약 검증은 파괴적 변경 없이 반복 가능해야 한다.
6. 성능 시험은 작은 부하부터 단계적으로 실행한다.
7. 결과는 `demo/reports`에 JSON으로 남긴다.
8. fixture 생성·키 회전·상태 변경·정리는 로컬 대상에서만 기본 허용한다.

## 구성

```text
demo/
├─ server.mjs              # 정적 UI, 보안 프록시, 시나리오/성능 러너
├─ catalog.mjs             # AI Server 전체 기능 카탈로그
├─ lib.mjs                 # 계약 판정과 통계 함수
├─ public/                 # 브라우저 UI
├─ scenarios/core.json     # 자동 계약 시나리오
├─ fixtures/               # 지식 등록용 재현 데이터
├─ reports/                # 실행 결과(JSON, git 제외)
├─ test/                   # 데모 자체 단위 테스트
└─ docs/                   # 데모 운영 문서
```

## 탭별 역할

- 연결 설정: 대상 서버, appkey, timeout 설정과 STORE_A/STORE_B 구성·격리 검증·정리
- 전체 기능: 모든 endpoint의 요청/응답 수동 확인
- 자동 계약 검증: 상태, 인증, correlation, 일반 답변, 검색, 제품 답변, HTTP·내부 API 노출 계약 확인
- 성능 검증: 성공률, 처리량, latency percentile, 상태 코드와 토큰 집계

## 고도화 단계

### 1단계: 현재 구현

- 전체 기능 호출 카탈로그
- 핵심 계약 시나리오
- 제한 부하 시험
- Markdown/CSV fixture
- STORE_A/STORE_B tenant 격리용 버전 fixture manifest와 자동 setup/cleanup
- 교차 파일 상세·목록·검색, 변조 키, 키 회전, 비활성 키 자동 검증
- 결과 JSON 저장
- CORS·Swagger 및 legacy·개발 endpoint 운영 노출 자동 검증
- 플랫폼 관리자·지식 운영자·외부 appkey 역할 경계 검증
- appkey 만료·제한된 grace 회전·이전 키 종료와 감사 이벤트 자동 검증

### 2단계: AI Server 개선과 함께 확장

- `/v1` 외부 소비자 API 시나리오 추가
- 관리자 identity 인증과 감사 retention 검증
- STORE_A/STORE_B source 정답률 품질 시험
- PDF/DOCX/XLSX fixture와 parser 회귀 시험
- 인덱싱 비동기 job 상태 시험
- retry/timeout/throttling fault injection
- RAG 기준 질문과 예상 source를 이용한 품질 점수

### 3단계: 배포 승인 게이트

- CI에서 계약 suite 자동 실행
- staging 환경 smoke/baseline 성능 실행
- OpenAPI breaking change 검사
- 보안 및 dependency audit 결과 결합
- 승인 기준을 만족한 리포트만 release artifact에 첨부
