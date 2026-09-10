# 컴파일된 코드의 지속 시험과 ts-node 비교

2026-09-05. `npm run test:multiprocess-soak-compiled`를 추가했다. 같은 생산 TypeScript 코드와 시험 코드를 `tsconfig.soak.json`으로 `work/soak-build`에 컴파일한 뒤 부모 시험 프로세스와 child 워커 모두 일반 Node.js로 실행한다. 별도 시험 빌드이며 배포된 컨테이너나 전체 Nest HTTP 서버의 실행 결과는 아니다.

## 비교 조건

이전 [ts-node 지속 시험](MULTIPROCESS_SOAK_2026-09-05.md)과 동일하게 워커 3개, 파일 6개·파일당 16청크, 합성 embedding 50ms, 생산 기본 embedding 동시성 4, 실제 lease 300초, 작업 공급 390초를 사용한다. 시작 15초 후 processing 워커 하나를 강제 종료하고 새 워커를 실행한다. 종료된 작업의 자연 lease 만료/attempt 2 회수, 그동안 다른 작업 처리, 마지막 대기열·중복·워커 정상 종료를 동일하게 검사한다.

`scripts/build-soak.mjs`는 컴파일 후 생산 소스·스키마 fingerprint와 시험 코드·빌드 설정 fingerprint를 기록한다. 컴파일 실행의 provenance는 build 모드로 읽힌다. 워커 ready 메시지로 source/compiled 모드를 확인하며 실제 프로세스 명령줄에서도 `.js` 진입점과 ts-node 미사용을 확인했다.

생산 코드는 변경하지 않았다. 기존 ts-node 명령도 유지한다. 워커 진입점은 실행 파일 위치를 기준으로 `.ts` 또는 `.js`를 선택하므로 컴파일된 worker를 잘못된 소스 경로에서 실행하지 않는다.

## 결과

컴파일 실행 `40695ab1-36a0-49b2-ad2b-d1c7531be28e`: PASS. 공급 390초, 최종 보고까지 390.658초, 작업 4,021개 완료. 종료된 작업이 실제 lease 만료 465ms 뒤 attempt 2로 완료됐으며 회수 대기 동안 다른 작업 3,084개가 완료됐다. 최종 미완료·실패 작업 0, 최신 청크 96개, 살아 있는 워커 3개의 정상 종료 코드 0을 확인했다.

| 지표 | 이전 ts-node | 컴파일 실행 |
| --- | ---: | ---: |
| 완료 작업 | 3,986 | 4,021 |
| 작업 요청→완료 p50 | 463ms | 457ms |
| 작업 요청→완료 p95 | 570ms | 561ms |
| 최대 작업 지연(lease 대기 포함) | 300,671ms | 300,656ms |
| 종료된 작업의 lease 만료→완료 | 402ms | 465ms |
| 장기 실행 PID의 최대 RSS 범위 | 844.8~866.4MiB | 317.1~321.1MiB |
| 최대 워커 DB 연결 / active 연결 | 6 / 3 | 6 / 2 |

컴파일 실행에서는 장기 실행 PID의 최대 RSS가 이전보다 약 62% 낮았다. CPU 시간은 아래와 같으며 이전과 비슷하거나 다소 높아 CPU 개선을 주장하지 않는다. 처리 건수·p95 차이 역시 두 단일 실행 사이의 관측값이다.

| 컴파일 PID | 역할 | RSS 시작 | RSS 마지막 | 표본 최대 RSS | 수집 CPU 시간 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 25592 | 강제 종료 | 159.6MiB | 302.7MiB | 302.7MiB | 1.954초 |
| 9568 | 지속 실행 | 168.2MiB | 316.2MiB | 317.1MiB | 35.126초 |
| 21448 | 지속 실행 | 155.6MiB | 320.3MiB | 321.1MiB | 34.453초 |
| 14944 | 재시작 | 170.7MiB | 316.2MiB | 318.9MiB | 31.671초 |

원본 `outputs/multiprocess-soak/40695ab1-36a0-49b2-ad2b-d1c7531be28e/`에 `report.json`, `samples.json`, `build-info.json`을 보존했다. Node v24.15.0, build provenance mode=build, workingTreeDirty=true다. 임시 DB `queue_e2e_4f8df26839194dcbad7044e76ff647a3` 삭제 완료. 서버 build/typecheck/lint·단위 197개·데모 37개 PASS.

통합 회귀도 7 suites / 39개 PASS, 전용 부하 4개 skip(43.115초). 통합 DB `queue_e2e_3d5bb479de6e49d89f11d65e605f0533` 삭제와 컴파일 시험 프로세스 잔여 없음까지 확인했다.

## 해석 범위

같은 호스트에서 순차적으로 각각 한 번 수행한 비교다. CPU·RSS는 시험 adapter와 Node 런타임을 포함하며 DB 서버 자원은 별도다. CPU 시간과 처리량 차이를 모두 컴파일 방식의 효과로 단정하지 않는다. 특히 작업 완료 수에는 startup 동안 처리된 초기 작업이 포함돼 공급 시간으로 나눈 값을 엄밀한 정상 상태 처리량으로 볼 수 없다.

RSS 시작/마지막/표본 최대는 PID별로 비교한다. 첫 워커는 약 15초 만에 종료되므로 전체 기간 실행한 워커와 분리한다. 장시간 메모리 누수와 운영 capacity는 이번 단일 실행만으로 판정하지 않는다.
