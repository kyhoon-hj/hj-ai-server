# ZINFrame P4 대응 운영 배포

2026-09-08, 가족 대화 capability 비활성 상태에서 HJ 앱 컨테이너를 교체하고 공개 health·관리자/앱키 인증·비활성 차단을 확인했다. 기존 앱 7개와 검증 데모 컨테이너는 보존됐다. 이번 수용 시험의 모델 호출은 0이다.

- 현재 이미지: `608311474994.dkr.ecr.ap-northeast-2.amazonaws.com/hj-ai-server@sha256:b940f5370d52ef79843ed602aad114fa0ab7635557b77e509a2f6fe73e96f96f`.
- release: `/home/ubuntu/hj-ai-releases/p4-aa2ffc1191a7080d`.
- 원본 compose와 `deploy/p4-image.json` override를 함께 사용한다. 후자는 root 전용 실제 환경·이미지 고정 파일이다. `RELEASE_TAG=20260907-03`은 유지된 검증 데모의 태그다.
- backup: `/home/ubuntu/hj-ai-backups/p4-aa2ffc1191a7080d`.
- DB `hj-ai` 18.3: migration 13개 모두 동일, 추가 없음. custom dump·catalog 검증 완료, 실제 전체 DB 복원은 미실행.
- 이전 이미지: `sha256:9426461dd00c725ed687d1dedf637e441226fb4a03af20a38dd411a87827821a`.
- 복구에는 이전 compose와 backup의 `rollback-image.json`을 함께 사용하고 이미지·health·인증·환경을 재검증한다. 운영 rollback은 실행하지 않았다.

Compose `config`가 literal dollar를 이중 표시하여 발생한 초기 환경 차이 판정은 비교 오류였다. 정규화 후 기존 환경과 실제 runtime의 일치를 확인했다. 키 회전은 하지 않았다. override 작성 시 dollar escape를 적용했다.

ZINFrame 저장소의 상세 결과: `doc/testing/FRAME_FAMILY_CONVERSATION_P4_HJ_PRODUCTION_RESULT_2026-09-08.md`.
실행 스크립트: `C:/Work/HJSolution/ZINFrame/deployment/scripts/deploy-family-hj.py`.
통합 증빙: `C:/Work/HJSolution/ZINFrame/doc/testing/results/p4-hj-production-5b9b3115-3929-4656-8a63-87a94166b499.json`.

P4 전체·실제 provider 확대 평가·가족 대화 운영 활성화는 아직 완료되지 않았다.
