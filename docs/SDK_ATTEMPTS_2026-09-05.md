# SDK 시도 횟수와 재시도 지연

Bedrock Converse 및 일반 답변, RAG 생성 성공 응답에 `sdk`를 추가했다. SDK `$metadata.attempts`에서 최초 시도를 포함한 횟수를 읽고 retryCount=attempts−1, totalRetryDelayMs=`$metadata.totalRetryDelay`로 기록한다. 유효한 메타데이터가 없으면 null이며 재시도 정책은 변경하지 않는다.

성공 응답의 scope=generation은 생성 호출 한 번의 SDK 시도다. 검색 임베딩·스토리지 등 모든 호출의 합계는 아니다. strict 근거 부족으로 생성하지 않은 응답에는 생성 SDK 측정값을 넣지 않는다. RAG QueryLog execution.sdk에 성공 및 실패 단계의 측정값을 저장한다.

오류 응답은 메타데이터가 있는 경우만 scope=failed-call로 공개한다. 해당 실패 호출의 측정값이며 앞서 성공한 호출은 포함하지 않는다. AWS deadline 오류를 HTTP 504로 변환할 때도 사용 가능한 카운터를 보존한다. 원본 SDK requestId와 오류 상세는 공개하지 않는다. 메타데이터 없는 취소·타임아웃은 미측정이다.

데모 리포트 summary.sdk는 generation과 failed-call 각각의 시도 횟수·재시도 횟수·재시도 지연에 측정 응답 수, 평균, p50, p95를 제공한다. 화면과 기준 비교 표에는 시도 및 지연 p95를 추가했다. 누락 값은 집계 분모에서 제외하며 전체 서버 SDK 횟수는 계속 미측정으로 표시한다.

## 검증

- 서버 206개, 데모 50개 테스트 통과.
- 실제 AWS SDK 클라이언트에 합성 requestHandler를 연결했다. 429 후 성공과 429 재시도 소진 모두 시도 2회·재시도 1회 및 지연 메타데이터 확인. 네트워크/AWS 호출 없음.
- RAG 응답 및 실행 기록 전달, 실패 응답 카운터 필터링, 누락/비정상 메타데이터, 데모의 scope별 집계 검증.
- 빌드, 타입 검사, 린트 확인. 브라우저 화면 및 실제 AWS 환경 재검증은 이번 작업에서 실행하지 않았다.

다음 단계는 검색 임베딩을 포함하는 요청 단위 SDK 호출 집계와 동시 요청 간 격리 검증이다.
