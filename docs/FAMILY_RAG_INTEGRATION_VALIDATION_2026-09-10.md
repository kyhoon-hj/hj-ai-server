# Family RAG 격리 PostgreSQL 통합 검증

검증일: 2026-09-10  
대상 브랜치: `codex/demo-api-validation`

## 검증 범위

- 빈 격리 PostgreSQL 데이터베이스에 전체 migration 16개 적용
- Family 지식 UPSERT 이벤트의 idempotent 재수신과 durable 상태 저장
- 비동기 색인, 1024차원 pgvector 저장 및 tenant 범위 검색
- transient embedding 오류의 retry 상태 저장과 attempt 2 완료
- 검색 근거와 짧은 서버 검증 사실을 결합한 `frame-family-rag-v1` 대화
- 대화 중 근거 삭제 시 응답 폐기, 청크 삭제 및 지표 미저장
- 실행 종료 후 무작위 격리 데이터베이스 자동 삭제

실제 Bedrock 호출은 수행하지 않았다. 임베딩과 Converse 응답은 결정론적 adapter로
대체했지만 PostgreSQL transaction, advisory lock, migration, pgvector 연산과 Prisma
adapter는 실제 구성으로 실행했다.

## 발견 및 수정

실제 PostgreSQL 실행에서 advisory lock 키에 사용한 NUL(`U+0000`) 구분자가 text
파라미터로 전달될 수 없어 모든 Family 이벤트가 실패했다. 잠금 키를 두 값의 JSON
직렬화로 변경해 충돌 없는 경계를 유지하면서 PostgreSQL-safe text로 만들었다.

이후 `pg_advisory_xact_lock`의 `void` 반환값을 Prisma가 역직렬화할 수 없는 문제가
확인됐다. 반환값을 `text`로 명시적으로 cast해 잠금 실행과 Prisma 호환성을 함께
확보했다. 이벤트 수신과 색인 publish 양쪽 잠금 경로에 동일하게 적용했다.

## 결과

```text
npm test -- --runInBand src/family-knowledge
6 suites, 36 tests PASS

npm run typecheck
PASS

npm run lint:check
PASS

npm run test:queue-http-e2e
8 suites PASS, 42 tests PASS, 4 tests SKIP
16 migrations applied
isolated database removed
```

첫 전체 E2E 실행에서는 기존 DB 소켓 단절 복구 시험이 연결 재수립 시점에 1회
실패했다. 변경 없이 동일 명령을 다시 실행해 전체 PASS를 확인했다. 신규 Family
RAG 스위트는 최종 실행에서 3/3 PASS다.

## 운영 전 남은 범위

1. 실제 Bedrock embedding/Converse provider를 사용하는 제한된 staging 수용 시험
2. ~~운영 DB backup 및 migration 13개 → 16개 preflight와 rollback 절차 검증~~
   — 2026-09-10 비활성 배포 완료
3. `FRAME_FAMILY_RAG_ENABLED`와 정확한 appcode allowlist를 사용한 단계적 활성화
4. ZINFrame provider 이벤트부터 최종 대화까지의 교차 프로젝트 수용 시험
