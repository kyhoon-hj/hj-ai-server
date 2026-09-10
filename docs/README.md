# HJ AI Server 문서

- [서비스 데모 시간 초과 및 EC2 중지 복구 (2026-09-06)](SERVICE_OUTAGE_2026-09-06.md)

- [답변 품질 개선 및 평가 방안 (2026-09-06)](ANSWER_QUALITY_IMPROVEMENT_2026-09-06.md)

- [상품 목록 질문 거절 원인 및 서비스 데모 수정 (2026-09-06)](CATALOG_QUERY_FIX_2026-09-06.md)

- [검증·서비스 데모 상세 테스트 가이드 및 실행 결과 (2026-09-06)](DEMO_TEST_GUIDE_2026-09-06.md)

- [AI 서버·검증 데모·서비스 데모 운영 배포 완료 (2026-09-06)](PRODUCTION_DEPLOYMENT_2026-09-06.md)

- [성능 프리셋·실행 비교 (2026-09-05)](PERFORMANCE_PRESETS_2026-09-05.md)

- [RAG 단계별 시간·토큰 측정 (2026-09-05)](RAG_PERFORMANCE_TELEMETRY_2026-09-05.md)

- [컴파일 지속 시험·ts-node 메모리 비교 (2026-09-05)](COMPILED_SOAK_2026-09-05.md)

- [별도 워커 프로세스·5분 lease 지속 처리 (2026-09-05)](MULTIPROCESS_SOAK_2026-09-05.md)

- [여러 청크 반복 부하·자원 측정 (2026-09-05)](EXTENDED_NETWORK_LOAD_2026-09-05.md)

- [동시 파일 부하·DB 복구 시간 측정 (2026-09-05)](NETWORK_LOAD_2026-09-05.md)

- [비대칭 DB 단절·이전 워커 결과 차단 (2026-09-05)](ASYMMETRIC_PARTITION_2026-09-05.md)

- [다중 워커 DB 단절 복구 (2026-09-05)](MULTI_WORKER_PARTITION_2026-09-05.md)

- [DB COMMIT 응답 유실 복구 (2026-09-05)](DB_COMMIT_RESPONSE_LOSS_2026-09-05.md)

- [실제 AWS 연결 장애 복구 (2026-09-05)](LIVE_AWS_CONNECTION_RECOVERY_2026-09-05.md)

- [소켓 단절·외부 의존성 복구 검증 (2026-09-05)](NETWORK_RECOVERY_2026-09-05.md)

- [RAG 실행·색인 버전 추적 (2026-09-05)](EXECUTION_PROVENANCE_2026-09-05.md)
- [구현·검증 인수인계 (2026-09-04)](IMPLEMENTATION_AND_VALIDATION_2026-09-04.md)

- [운영 인프라 현행 구성(As-Is)](OPERATIONS_INFRASTRUCTURE_AS_IS.md)
- [AI Server·검증 데모·서비스 데모 통합 로드맵](DEMO_AI_SERVER_INTEGRATED_ROADMAP.md)
- [서비스 데모 개발 계획](SERVICE_DEMO_PLAN.md)
- [애플리케이션 포트 표준](PORT_STANDARD.md)
- [다음 작업 섹션 인계서 (2026-08-23)](HANDOFF_2026-08-23.md)
- [외부 앱 공통 API 명세 초안](COMMON_API_SPEC_DRAFT.md)
- [AI Server 실서비스 고도화 계획](AI_SERVER_HARDENING_PLAN.md)
- [기능·품질·성능 검증 전략](TEST_AND_PERFORMANCE_STRATEGY.md)
- [2026-08-18 품질 기준선 개선 이력](QUALITY_BASELINE_2026-08-18.md)
- [2026-08-18 의존성 감사 개선 이력](DEPENDENCY_AUDIT_2026-08-18.md)
- [2026-08-19 CI 품질 게이트 구축 이력](CI_QUALITY_GATE_2026-08-19.md)
- [관리자 API 보안 계약](ADMIN_API_SECURITY.md)
- [API 역할·권한 매트릭스](RBAC_ROLE_MATRIX.md)

검증 콘솔의 설계·사용·검증 매트릭스는 [`demo/docs`](../demo/docs/)에서 관리합니다. 실제 사용자 서비스를 가정한 데모는 검증 콘솔과 분리해 `service-demo/`로 개발합니다.
# 최신 성능 관측 작업

- [AWS 운영 AI 서버 실측 구성](AWS_PRODUCTION_DISCOVERY_2026-09-05.md)

- [AI 서버·두 데모 배포 준비 상태](DEPLOYMENT_CANDIDATE_2026-09-05.md)

- [실제 AWS 소규모 성능 기준선](LIVE_PERFORMANCE_BASELINE_2026-09-05.md)

- [인증 포함 데모 성능 리포트 검증](AUTHENTICATED_DEMO_METRICS_2026-09-05.md)

- [요청 SDK 집계 HTTP 및 화면 검증](REQUEST_SDK_HTTP_VALIDATION_2026-09-05.md)

- [요청 단위 AWS 측정](REQUEST_SDK_METRICS_2026-09-05.md)

- [SDK 시도 횟수와 재시도 지연](SDK_ATTEMPTS_2026-09-05.md)

- [성능 시험 실패 유형 및 재시도 관측](PERFORMANCE_OUTCOMES_2026-09-05.md)
