let catalog = [];
const $ = (selector) => document.querySelector(selector);

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
  return body;
}

function parseJson(selector) {
  const value = $(selector).value.trim();
  return value ? JSON.parse(value) : {};
}

function renderMetrics(target, entries) {
  $(target).innerHTML = entries.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function optionMarkup(items) {
  const groups = Map.groupBy(items, (operation) => operation.group);
  return [...groups].map(([group, values]) => `<optgroup label="${group}">${values.map((operation) => `<option value="${operation.id}">${operation.label}</option>`).join('')}</optgroup>`).join('');
}

function currentOperation() {
  return catalog.find((operation) => operation.id === $('#operation').value);
}

function updateOperationMeta() {
  const operation = currentOperation();
  $('#operationMeta').textContent = `${operation.method} ${operation.path}${operation.destructive ? ' · 파괴적 요청' : ''}`;
  const presets = {
    'app.create': { appname: 'Demo Store A', appcode: 'demo-store-a', allowedAccessLevels: ['PUBLIC'], status: 'active', maxStorageMb: 100, monthlyTokenLimit: 100000 },
    'bedrock.converse': { message: '이 API 서버의 역할을 한 문단으로 설명해 주세요.', maxTokens: 512, temperature: 0.2 },
    'bedrock.text': { message: '안녕하세요.' },
    'bedrock.general': { query: '클라우드 컴퓨팅이 무엇인가요?' },
    'knowledge.text': { originalName: 'demo-policy.md', content: '구매 후 7일 이내 영수증과 미사용 상품이 있으면 교환할 수 있습니다.', accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: ['DEMO'] },
    'knowledge.policy': { accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: ['DEMO'] },
    'knowledge.search': { query: '교환 정책을 알려주세요.', limit: 5, filters: { accessLevels: ['PUBLIC'], businessStatuses: ['PUBLISHED'] } },
    'knowledge.rag': { query: '교환 정책을 알려주세요.', strict: true, includeSources: true, maxTokens: 512 },
    'knowledge.answers': { query: '교환 정책을 알려주세요.', strict: true, includeSources: true, maxTokens: 512 },
  };
  $('#requestBody').value = JSON.stringify(presets[operation.id] ?? {}, null, 2);
}

function renderServerTargets(config) {
  const container = $('#serverTargets');
  container.replaceChildren();
  for (const target of config.targets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `target-option${target.id === config.activeTarget ? ' active' : ''}`;
    button.dataset.url = target.url;
    button.setAttribute('aria-pressed', target.id === config.activeTarget ? 'true' : 'false');

    const label = document.createElement('strong');
    label.textContent = target.label;
    const url = document.createElement('code');
    url.textContent = target.url;
    button.append(label, url);
    button.addEventListener('click', () => {
      $('#baseUrl').value = target.url;
      document.querySelectorAll('.target-option').forEach((option) => {
        const active = option === button;
        option.classList.toggle('active', active);
        option.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
    container.append(button);
  }
}

async function loadConfig() {
  const config = await api('/api/config');
  $('#baseUrl').value = config.baseUrl;
  $('#swaggerPath').value = config.swaggerPath;
  $('#corsAllowedOrigin').value = config.corsAllowedOrigin;
  $('#timeoutMs').value = config.timeoutMs;
  renderServerTargets(config);
  const badge = $('#connectionBadge');
  const targetLabel = config.targets.find((target) => target.id === config.activeTarget)?.label ?? '사용자 지정';
  badge.textContent = `${targetLabel} · ${config.baseUrl} · appkey ${config.hasAppkey ? '설정' : '없음'} · admin ${config.hasAdminKey ? '설정' : '없음'} · operator ${config.hasOperatorKey ? '설정' : '없음'}`;
  badge.classList.toggle('ready', config.hasAppkey && config.hasAdminKey && config.hasOperatorKey);
}

function renderDemoReport(report) {
  $('#demoEnvironmentResult').textContent = JSON.stringify(report, null, 2);
}

async function loadDemoState() {
  const state = await api('/api/demo/state');
  const status = $('#demoEnvironmentStatus');
  status.textContent = state.ready ? 'READY' : 'NOT READY';
  status.classList.toggle('ready', state.ready);
  const profiles = $('#demoProfiles');
  profiles.replaceChildren();
  if (state.profiles.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '구성된 데모 tenant가 없습니다.';
    profiles.append(empty);
  } else {
    for (const profile of state.profiles) {
      const item = document.createElement('div');
      item.className = 'profile-item';
      const code = document.createElement('strong');
      code.textContent = profile.appcode;
      const files = document.createElement('span');
      files.textContent = `fixture ${profile.fileCount}개`;
      item.append(code, files);
      profiles.append(item);
    }
  }
  $('#runTenantValidation').disabled = !state.ready;
  $('#runInternalExposure').disabled = !state.ready;
  return state;
}

async function runDemoAction(button, busyLabel, action) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    const report = await action();
    renderDemoReport(report);
    await Promise.all([loadConfig(), loadDemoState()]);
    return report;
  } catch (error) {
    renderDemoReport({ error: error.message });
    toast(error.message);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab, .panel').forEach((element) => element.classList.remove('active'));
  button.classList.add('active');
  $(`#${button.dataset.tab}`).classList.add('active');
}));

$('#configForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({ baseUrl: $('#baseUrl').value, appkey: $('#appkey').value, adminKey: $('#adminKey').value, operatorKey: $('#operatorKey').value, swaggerPath: $('#swaggerPath').value, corsAllowedOrigin: $('#corsAllowedOrigin').value, timeoutMs: Number($('#timeoutMs').value) }) });
    $('#appkey').value = '';
    $('#adminKey').value = '';
    $('#operatorKey').value = '';
    await loadConfig();
    toast('연결 설정을 저장했습니다.');
  } catch (error) { toast(error.message); }
});

$('#clearAdminKey').addEventListener('click', async () => {
  await api('/api/config', { method: 'PUT', body: JSON.stringify({ clearAdminKey: true }) });
  await loadConfig();
  toast('관리자 credential을 제거했습니다.');
});

$('#clearOperatorKey').addEventListener('click', async () => {
  await api('/api/config', { method: 'PUT', body: JSON.stringify({ clearOperatorKey: true }) });
  await loadConfig();
  toast('지식 운영자 credential을 제거했습니다.');
});

$('#clearKey').addEventListener('click', async () => {
  await api('/api/config', { method: 'PUT', body: JSON.stringify({ clearAppkey: true }) });
  await loadConfig();
  toast('appkey를 제거했습니다.');
});

$('#setupDemoData').addEventListener('click', async () => {
  const report = await runDemoAction($('#setupDemoData'), '구성 중...', () => api('/api/demo/setup', {
    method: 'POST',
    body: JSON.stringify({ confirmSetup: true }),
  }));
  if (report) toast('STORE_A / STORE_B 검증 환경을 구성했습니다.');
});

$('#runTenantValidation').addEventListener('click', async () => {
  const report = await runDemoAction($('#runTenantValidation'), '검증 중...', () => api('/api/demo/tenant-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`테넌트 검증: ${report.summary.passed}/${report.summary.total} PASS`);
});

$('#runRbacValidation').addEventListener('click', async () => {
  const report = await runDemoAction($('#runRbacValidation'), '검증 중...', () => api('/api/demo/rbac-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`역할 권한 검증: ${report.summary.passed}/${report.summary.total} PASS`);
});

$('#cleanupDemoData').addEventListener('click', async () => {
  if (!$('#confirmCleanup').checked) {
    toast('데모 데이터 정리 확인을 선택해 주세요.');
    return;
  }
  const report = await runDemoAction($('#cleanupDemoData'), '정리 중...', () => api('/api/demo/cleanup', {
    method: 'POST',
    body: JSON.stringify({ confirmCleanup: true, confirmation: 'DELETE_DEMO_DATA' }),
  }));
  if (report) {
    $('#confirmCleanup').checked = false;
    toast('검증 데이터를 정리했습니다.');
  }
});

$('#operation').addEventListener('change', updateOperationMeta);
$('#invokeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/invoke', { method: 'POST', body: JSON.stringify({ operationId: $('#operation').value, params: parseJson('#params'), query: parseJson('#query'), body: parseJson('#requestBody'), confirmDestructive: $('#confirmDestructive').checked }) });
    $('#response').textContent = JSON.stringify(result, null, 2);
    renderMetrics('#responseSummary', [['HTTP', result.status], ['응답시간', `${result.durationMs} ms`], ['Correlation', result.headers?.correlationId ? 'OK' : '없음']]);
  } catch (error) { $('#response').textContent = error.message; }
});

$('#copyResponse').addEventListener('click', async () => { await navigator.clipboard.writeText($('#response').textContent); toast('응답을 복사했습니다.'); });

$('#uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('#uploadFile').files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const result = await api(`/api/upload?operationId=${encodeURIComponent($('#uploadOperation').value)}&params=${encodeURIComponent($('#uploadParams').value)}`, { method: 'POST', body: form });
    $('#response').textContent = JSON.stringify(result, null, 2);
    toast(result.ok ? '업로드가 완료되었습니다.' : '업로드 응답을 확인하세요.');
  } catch (error) { toast(error.message); }
});

$('#downloadForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const key = $('#downloadKey').value.trim();
  if (key) window.location.assign(`/api/download?key=${encodeURIComponent(key)}`);
});

$('#runContract').addEventListener('click', async () => {
  const button = $('#runContract');
  button.disabled = true;
  button.textContent = '실행 중...';
  try {
    const report = await api('/api/scenarios/run', { method: 'POST', body: '{}' });
    renderMetrics('#contractSummary', [['전체', report.summary.total], ['PASS', report.summary.passed], ['FAIL', report.summary.failed], ['SKIP', report.summary.skipped], ['리포트', report.reportFile]]);
    $('#contractResults').innerHTML = report.results.map((item) => `<div class="result ${item.skipped ? 'skipped' : item.passed ? '' : 'failed'}"><strong>${item.id}</strong><span>${item.name}<small>${item.reasons?.join(', ') ?? ''}</small></span><span class="status">${item.skipped ? 'SKIP' : item.passed ? 'PASS' : 'FAIL'}</span></div>`).join('');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '전체 실행'; }
});

$('#runHttpExposure').addEventListener('click', async () => {
  const button = $('#runHttpExposure');
  button.disabled = true;
  button.textContent = '검증 중...';
  try {
    const report = await api('/api/demo/http-exposure-validation', { method: 'POST', body: '{}' });
    renderMetrics('#httpExposureSummary', [['전체', report.summary.total], ['PASS', report.summary.passed], ['FAIL', report.summary.failed], ['Swagger 경로', report.swaggerPath], ['허용 Origin', report.corsAllowedOrigin], ['리포트', report.reportFile]]);
    $('#httpExposureResults').innerHTML = report.results.map((item) => `<div class="result ${item.passed ? '' : 'failed'}"><strong>${item.id}</strong><span>${item.name}<small>${item.reasons?.join(', ') ?? ''}</small></span><span class="status">${item.passed ? 'PASS' : 'FAIL'}</span></div>`).join('');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '노출 정책 검증'; }
});

$('#runInternalExposure').addEventListener('click', async () => {
  const button = $('#runInternalExposure');
  button.disabled = true;
  button.textContent = '검증 중...';
  try {
    const report = await api('/api/demo/internal-exposure-validation', { method: 'POST', body: JSON.stringify({ confirmValidation: true }) });
    renderMetrics('#internalExposureSummary', [['전체', report.summary.total], ['PASS', report.summary.passed], ['FAIL', report.summary.failed], ['리포트', report.reportFile]]);
    $('#internalExposureResults').innerHTML = report.results.map((item) => `<div class="result ${item.passed ? '' : 'failed'}"><strong>${item.id}</strong><span>${item.name}<small>${item.reasons?.join(', ') ?? ''}</small></span><span class="status">${item.passed ? 'PASS' : 'FAIL'}</span></div>`).join('');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '내부 API 경계 검증'; }
});

$('#performanceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const report = await api('/api/performance/run', { method: 'POST', body: JSON.stringify({ operationId: $('#performanceOperation').value, total: Number($('#totalRequests').value), concurrency: Number($('#concurrency').value), body: parseJson('#performanceBody') }) });
    const summary = report.summary;
    renderMetrics('#performanceSummary', [['성공률', `${summary.successRate}%`], ['처리량', `${summary.throughputPerSecond}/s`], ['p50', `${summary.latencyMs.p50} ms`], ['p95', `${summary.latencyMs.p95} ms`], ['p99', `${summary.latencyMs.p99} ms`], ['평균 토큰', summary.tokens.averagePerRequest]]);
    $('#performanceResult').textContent = JSON.stringify(report, null, 2);
  } catch (error) { toast(error.message); }
});

async function bootstrap() {
  catalog = await api('/api/catalog');
  $('#operation').innerHTML = optionMarkup(catalog.filter((operation) => !operation.upload && !operation.download));
  $('#performanceOperation').innerHTML = optionMarkup(catalog.filter((operation) => operation.performanceSafe));
  $('#performanceOperation').value = 'knowledge.answers';
  updateOperationMeta();
  await Promise.all([loadConfig(), loadDemoState()]);
}

bootstrap().catch((error) => toast(error.message));
