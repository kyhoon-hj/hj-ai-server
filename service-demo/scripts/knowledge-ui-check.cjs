// Run after knowledge-ui-fixture.cjs and a fresh snapshot of the fixture page.
async (page) => {
  const state = page.knowledgeUiFixture;
  if (!state) throw new Error('Load knowledge-ui-fixture.cjs first');
  const button = name => page.getByRole('button', { name, exact: true });
  const visible = text => page.getByText(text, { exact: false }).waitFor({ timeout: 20000 });
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  state.mode = 'timeout';
  await button('재인덱싱').click();
  await visible('작업 실패를 의미하지 않습니다');
  check(await button('작업 상태 다시 확인').isVisible(), 'Missing resume action');
  check(await page.getByText('· ID 22222222', { exact: false }).isVisible(), 'Missing correlation ID');
  check(await page.getByRole('combobox', { name: '관리 매장' }).isEnabled(), 'Controls remain locked');
  const mutations = state.mutations;
  state.mode = 'complete';
  await button('작업 상태 다시 확인').click();
  await visible('인덱싱을 완료했습니다');
  check(state.mutations === mutations, 'Status recovery submitted a new job');
  for (const [mode, expected, retry] of [
    ['permanent', '영구 실패', false],
    ['exhausted', '재시도 횟수를 모두 사용', false],
    ['retryable', '다시 시도할 수 있습니다', true],
  ]) {
    state.mode = mode;
    await button('재인덱싱').click();
    await visible(expected);
    check(await button('실패 작업 다시 시도').isVisible() === retry, `Retry control mismatch: ${mode}`);
  }
  state.mode = 'complete';
  await button('실패 작업 다시 시도').click();
  await visible('인덱싱을 완료했습니다');
  state.mode = 'backoff';
  await button('재인덱싱').click();
  await visible('다음 시도를 기다리고 있습니다');
  check(await button('재인덱싱').isDisabled(), 'Duplicate mutation enabled during polling');
  check(await page.getByRole('combobox', { name: '관리 매장' }).isDisabled(), 'Tenant switching enabled during polling');
  state.mode = 'complete';
  await visible('인덱싱을 완료했습니다');
  state.mode = 'client-timeout';
  await button('재인덱싱').click();
  await visible('작업 실패를 의미하지 않습니다');
  check(await button('작업 상태 다시 확인').isVisible(), 'Client timeout cannot resume');
  const beforeResume = state.mutations;
  state.mode = 'complete';
  await button('작업 상태 다시 확인').click();
  await visible('인덱싱을 완료했습니다');
  check(state.mutations === beforeResume, 'Client timeout recovery duplicated job');
  return { result: 'PASS', scenarios: 6, statusRecoveryCreatesJobs: false, clientDeadlineMs: 10000 };
}
