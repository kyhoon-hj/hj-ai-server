// Load with playwright-cli run-code --filename. Browser-only synthetic BFF responses.
async (page) => {
  await page.unrouteAll({ behavior: 'wait' });
  const state = { mode: 'timeout', polls: 0, mutations: 0 };
  page.knowledgeUiFixture = state;
  const requestId = '22222222-2222-4222-8222-222222222222';
  const file = { id: 'ui-file', name: 'synthetic-policy.md', mimeType: 'text/markdown', size: 100, status: 'indexed', businessStatus: 'PUBLISHED', accessLevel: 'PUBLIC', productCodes: [], indexedAt: null, createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z', chunkCount: 1, hasError: false };
  const job = { id: 'ui-job', fileId: file.id, operation: 'reindex', status: 'processing', attempt: 1, maxAttempts: 3, retryable: false, canRetry: false, requestedAt: '', startedAt: null, completedAt: null, nextAttemptAt: null };
  await page.route('**/api/manager-session', route => route.fulfill({ json: { active: true, requestId } }));
  await page.route('**/api/knowledge/files**', async route => {
    const url = route.request().url();
    const send = (value, status = 200) => route.fulfill({ status, json: { tenantId: 'STORE_A', requestId, ...value }, headers: { 'x-correlation-id': requestId } });
    if (route.request().method() !== 'GET') {
      state.mutations++;
      return send({ job }, 202);
    }
    if (!url.includes('jobId=')) return send({ files: [file] });
    state.polls++;
    if (state.mode === 'timeout') return send({ code: 'UPSTREAM_TIMEOUT', message: '응답 시간 초과' }, 504);
    // Hold a request past the real browser apiRequest 10-second abort deadline.
    if (state.mode === 'client-timeout') {
      await page.waitForTimeout(11500);
      return send({ job }).catch(() => {});
    }
    if (state.mode === 'permanent') return send({ job: { ...job, status: 'failed' } });
    if (state.mode === 'exhausted') return send({ job: { ...job, status: 'failed', attempt: 3, retryable: true } });
    if (state.mode === 'retryable') return send({ job: { ...job, status: 'failed', retryable: true, canRetry: true } });
    if (state.mode === 'backoff') return send({ job: { ...job, status: 'queued', nextAttemptAt: '2026-09-04T00:00:00Z', retryable: true } });
    return send({ job: { ...job, status: 'completed' } });
  });
  await page.goto('http://127.0.0.1:11002/knowledge');
  await page.getByRole('button', { name: '재인덱싱', exact: true }).waitFor();
}
