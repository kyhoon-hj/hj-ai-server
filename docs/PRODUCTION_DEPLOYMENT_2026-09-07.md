# 운영 배포 기록 — 2026-09-07

최종 릴리스 `20260907-03` 운영 전환 및 검증 완료.

| 서비스 | 주소 | 실행 환경 / 포트 |
| --- | --- | --- |
| AI Server | https://ai.hjshub.com | EC2 Docker, 127.0.0.1:11000 |
| 검증 데모·AppKey 관리 | https://ai.hjshub.com/validation/ | EC2 Docker, 127.0.0.1:11001, Basic 인증 |
| 서비스 데모 | https://hj-mart-assist.kyhoon-hj.chatgpt.site | Sites 버전 6, 소유자 로그인 필요 |

## 적용 내용

- AI 서버의 누적 수정 사항과 부분 답변 계약 배포.
- 검증 데모에 앱 생성·AppKey 발급·회전·활성 상태 관리 화면 배포.
- 매장 구조·층수 질문에 상품 위치를 근거로 확인된 층과 구역을 설명하도록 보완. 전체 층수와 확인되지 않은 시설은 확정하지 않는다.
- 테넌트 출처 검증의 질문을 해당 테넌트가 보유한 정책으로 수정. 출처가 해당 테넌트 파일에 속하는지 검사하는 조건은 유지.
- 서비스 데모는 현재 소스와 기존 배포 버전 6이 일치하여 중복 배포하지 않았다. 소스 커밋: `0d4bec84b9d65d9b55493340a7d70a14623d9958`.

## 검증 결과

- 로컬 AI 서버: 34개 테스트 묶음, 215개 테스트 통과. 빌드·정적 검사 통과.
- 검증 데모: 56개 테스트 통과. 서비스 데모: 기존 확인된 57개 테스트 및 빌드 통과.
- 최종 운영 인수 검증: 12/12 묶음 통과. 테넌트 격리, 권한, 키 수명주기, 파서, 파일 정책, 인덱싱, 성능 포함.
- 성능 스모크: 5/5 성공, 평균 약 3.43초, 타임아웃 0건. 소규모 스모크 결과이며 부하 한계를 의미하지 않는다.
- AppKey 관리 HTML·JS·CSS·앱 목록 API 인증 접근 200 확인.
- 외부 health/live·health/ready 200, 무인증 app-info 401, Swagger 경로 404 확인.
- 서비스 테넌트 키를 이용한 운영 AI 직접 질문: 상품 종류, 상품 개수, 매장 구조, 총 층수 모두 200 및 출처를 포함한 답변 확인. 이번 최종 점검은 서비스 데모 브라우저 클릭 검증을 포함하지 않는다.
- 답변 예: “자료에서 1층(A-04 구역)과 2층(C-02 구역), 총 2개 층이 확인되며, 전체 층수는 참고자료에서 확인할 수 없습니다.”

결과 파일: `outputs/demo-acceptance/production-20260907-03/summary.json`, `quality-probe.jsonl`.

## 운영 식별·복구

- AWS 계정: `608311474994`, 리전: `ap-northeast-2`.
- EC2: `i-0c6431bf77d888faf` (`works-server`).
- 릴리스 디렉터리: `/home/ubuntu/hj-ai-releases/20260907-03`.
- 이미지: `hj-ai-server:20260907-03`, `hj-ai-validation:20260907-03`.
- AI 소스 SHA256: `99abd1daa5f73c23c3f11399918a7ea9ec7f0bab6277dbd4893296b3a3cd0221`.
- 배포 아카이브 SHA256: `fad1a9d9dfa1afc71a3b4335e84e097bd9ce78f1f8314a4e011d42924df7908a`.
- 배포 전 DB·설정 백업: `/home/ubuntu/hj-ai-backups/20260907-03`. pg_dump와 pg_restore 목록 읽기 검증 완료. 전체 복원 리허설은 수행하지 않았다.
- 직전 릴리스 `20260907-02` 및 이미지 보존. DB 복원은 자동 수행하지 않는다.
- 임시 S3 전송 객체 3개와 버킷 삭제 완료.
- 검증 프로필은 메모리에 저장되어 재시작 시 검증 환경 구성이 필요하다. 검증용 앱은 서비스 데모용 앱과 분리되어 있다.

```sh
cd /home/ubuntu/hj-ai-releases/20260907-03
RELEASE_TAG=20260907-03 docker compose --project-name hj-ai-server --project-directory . -f deploy/compose.production.yml ps
```
