export const performancePresets = Object.freeze({
  smoke: Object.freeze({ label: 'Smoke', total: 5, concurrency: 1 }),
  baseline: Object.freeze({ label: 'Baseline', total: 20, concurrency: 2 }),
  burst: Object.freeze({ label: 'Burst', total: 50, concurrency: 5 }),
});

export function resolvePerformanceLoad(input) {
  const preset = input.preset ?? 'custom';
  if (preset !== 'custom' && !Object.hasOwn(performancePresets, preset)) throw new Error('알 수 없는 성능 프리셋입니다.');
  const selected = preset === 'custom' ? input : performancePresets[preset];
  const total = selected.total ?? 20;
  const concurrency = selected.concurrency ?? 1;
  if (!Number.isInteger(total) || total < 1 || total > 200) throw new Error('요청 수는 1~200의 정수여야 합니다.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20 || concurrency > total) throw new Error('동시성은 요청 수 이하인 1~20의 정수여야 합니다.');
  return { preset, total, concurrency };
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const canonical = (value) => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  return item;
});
export function validatePerformanceReport(report) {
  if (report?.type !== 'performance' || typeof report.operationId !== 'string' ||
      !report.configuration || !finite(report.summary?.latencyMs?.p95) ||
      !finite(report.summary?.successRate) || report.summary.successRate > 100) {
    throw new Error('유효한 성능 실행 JSON 리포트가 아닙니다.');
  }
  resolvePerformanceLoad({ ...report.configuration, preset: 'custom' });
  return report;
}
export function comparePerformanceReports(baseline, current) {
  validatePerformanceReport(baseline); validatePerformanceReport(current);
  const conditions = [
    ['대상 API', (r) => r.operationId], ['서버 URL', (r) => r.baseUrl],
    ['기록된 버전', (r) => r.serverCommit], ['요청 본문', (r) => r.configuration.body],
    ['요청 query', (r) => r.configuration.query ?? {}], ['요청 수', (r) => r.configuration.total],
    ['동시성', (r) => r.configuration.concurrency],
    ['HTTP 타임아웃', (r) => r.configuration.timeoutMs], ['데모 재시도 정책', (r) => r.configuration.retryPolicy],
    ['서버 maxTokens', (r) => r.summary.maxTokens?.effective],
  ];
  const differences = conditions.filter(([, get]) => canonical(get(baseline)) !== canonical(get(current))).map(([label]) => label);
  const fields = [
    ['성공률', '%', (s) => s.successRate], ['처리량', '건/초', (s) => s.throughputPerSecond],
    ['요청 전체 SDK 시도 p95', '회', (s) => s.awsRequest?.attempts?.p95],
    ['요청 전체 SDK 재시도 지연 p95', 'ms', (s) => s.awsRequest?.totalRetryDelayMs?.p95],
    ['최종 실패', '건', (s) => s.outcomes?.failed],
    ['HTTP 429', '건', (s) => s.outcomes?.rateLimited],
    ['데모 타임아웃', '건', (s) => s.outcomes?.timeout],
    ['연결 오류', '건', (s) => s.outcomes?.transportError],
    ['기타 HTTP 실패', '건', (s) => s.outcomes?.httpError],
    ['데모 재시도', '회', (s) => s.retries?.retryCount],
    ['생성 SDK 시도 p95', '회', (s) => s.sdk?.generation?.attempts?.p95],
    ['생성 SDK 재시도 지연 p95', 'ms', (s) => s.sdk?.generation?.totalRetryDelayMs?.p95],
    ['실패 호출 SDK 시도 p95', '회', (s) => s.sdk?.['failed-call']?.attempts?.p95],
    ['전체 p95', 'ms', (s) => s.latencyMs?.p95],
    ['검색 p95', 'ms', (s) => s.timings?.retrievalMs?.p95],
    ['생성 p95', 'ms', (s) => s.timings?.generationMs?.p95],
    ['평균 토큰', 'token', (s) => s.tokens?.averagePerRequest],
    ['토큰 측정 응답', '건', (s) => s.tokens?.measuredRequests?.total],
    ['검색 측정 응답', '건', (s) => s.timings?.retrievalMs?.measuredRequests],
    ['생성 측정 응답', '건', (s) => s.timings?.generationMs?.measuredRequests],
  ];
  const metrics = fields.map(([label, unit, get]) => {
    const before = get(baseline.summary); const after = get(current.summary);
    return { label, unit, baseline: finite(before) ? before : null, current: finite(after) ? after : null,
      delta: finite(before) && finite(after) ? Math.round((after - before) * 100) / 100 : null,
      changePercent: finite(before) && finite(after) && before !== 0 ? Math.round((after - before) / before * 10000) / 100 : null };
  });
  return { type: 'performance-comparison', schemaVersion: 1,
    baseline: { startedAt: baseline.startedAt ?? null, reportFile: baseline.reportFile ?? null },
    current: { startedAt: current.startedAt ?? null, reportFile: current.reportFile ?? null },
    differences, conditions: conditions.map(([label, get]) => ({ label, baseline: get(baseline) ?? null, current: get(current) ?? null })), metrics,
    note: '차이는 현재값−기준값입니다. 성공률 차이는 퍼센트포인트입니다. 요청 조건·서버 실행 버전·데이터 동일성과 반복 변동을 확인한 뒤 해석하세요. 자동 합격 판정은 하지 않습니다.' };
}
