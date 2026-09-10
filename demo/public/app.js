import { performancePresets, comparePerformanceReports, validatePerformanceReport } from './performance-tools.js';
let catalog = [];
const $ = (selector) => document.querySelector(selector);
const demoUrl = (path) => new URL(path.replace(/^\//, ''), new URL('./', import.meta.url));

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(demoUrl(path), {
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
    'app.rotateKey': { gracePeriodSeconds: 300, ttlDays: 90 },
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
  return config;
}

function formatDateTime(value) {
  if (!value) return '미설정';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function appendDefinition(list, label, value) {
  const item = document.createElement('div');
  const term = document.createElement('dt'); term.textContent = label;
  const description = document.createElement('dd'); description.textContent = value;
  item.append(term, description);
  list.append(item);
}

function dismissIssuedKey() {
  $('#issuedAppkey').value = '';
  $('#issuedAppkey').type = 'password';
  $('#toggleIssuedKey').textContent = '표시';
  $('#issuedKeyMeta').replaceChildren();
  $('#issuedKeyPanel').hidden = true;
}

function showIssuedKey(result, actionLabel) {
  const { app, issued } = result;
  $('#issuedKeyTitle').textContent = `${app.appname} ${actionLabel}`;
  $('#issuedAppkey').value = issued.appkey;
  const meta = $('#issuedKeyMeta');
  meta.replaceChildren();
  appendDefinition(meta, '앱 코드', app.appcode);
  appendDefinition(meta, '키 만료', formatDateTime(issued.expiresAt));
  appendDefinition(meta, '이전 키 허용 종료', formatDateTime(issued.previousAppkeyValidUntil));
  $('#issuedKeyPanel').hidden = false;
  $('#issuedKeyPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderAppList(apps) {
  const list = $('#appList');
  list.replaceChildren();
  if (apps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '등록된 앱이 없습니다.';
    list.append(empty);
    return;
  }

  for (const app of apps) {
    const item = document.createElement('article'); item.className = 'app-item';
    const head = document.createElement('div'); head.className = 'app-item-head';
    const title = document.createElement('div'); title.className = 'app-item-title';
    const name = document.createElement('h3'); name.textContent = app.appname;
    const code = document.createElement('code'); code.textContent = app.appcode;
    title.append(name, code);
    const status = document.createElement('span'); status.className = `status-pill${app.status === 'active' ? ' active' : ''}`; status.textContent = app.status;
    head.append(title, status);

    const meta = document.createElement('dl'); meta.className = 'app-item-meta';
    appendDefinition(meta, 'App ID', app.id);
    appendDefinition(meta, '접근 등급', app.allowedAccessLevels?.join(', ') || '제한 없음');
    appendDefinition(meta, 'AppKey 만료', formatDateTime(app.appkeyExpiresAt));
    appendDefinition(meta, '최근 회전', formatDateTime(app.appkeyRotatedAt));

    const actions = document.createElement('div'); actions.className = 'app-item-actions';
    const rotate = document.createElement('button'); rotate.type = 'button'; rotate.className = 'secondary'; rotate.textContent = 'AppKey 회전';
    rotate.addEventListener('click', () => {
      $('#rotateAppId').value = app.id;
      $('#rotateAppTitle').textContent = `${app.appname} AppKey 회전`;
      $('#rotateTtl').value = '90';
      $('#rotateGrace').value = '300';
      $('#confirmRotate').checked = false;
      $('#rotateDialog').showModal();
    });
    const changeStatus = document.createElement('button'); changeStatus.type = 'button'; changeStatus.className = app.status === 'active' ? 'danger' : 'secondary';
    const nextStatus = app.status === 'active' ? 'inactive' : 'active';
    changeStatus.textContent = app.status === 'active' ? '비활성화' : '활성화';
    changeStatus.addEventListener('click', async () => {
      const label = nextStatus === 'inactive' ? '비활성화하면 이 앱의 AppKey 요청이 거절됩니다.' : '활성화하면 이 앱의 AppKey를 다시 사용할 수 있습니다.';
      if (!window.confirm(`${app.appname} 앱을 ${changeStatus.textContent}하시겠습니까?\n\n${label}`)) return;
      changeStatus.disabled = true;
      try {
        await api(`/api/admin/apps/${encodeURIComponent(app.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, confirmStatusChange: true }) });
        dismissIssuedKey();
        await loadApps();
        toast(`앱을 ${nextStatus === 'active' ? '활성화' : '비활성화'}했습니다.`);
      } catch (error) { toast(error.message); }
      finally { changeStatus.disabled = false; }
    });
    actions.append(rotate, changeStatus);
    item.append(head, meta, actions);
    list.append(item);
  }
}

async function loadApps(options = {}) {
  const button = $('#refreshApps');
  button.disabled = true;
  try {
    const result = await api('/api/admin/apps');
    renderAppList(result.apps);
    $('#appAdminStatus').textContent = `총 ${result.apps.length}개 · ${new Date().toLocaleTimeString('ko-KR')} 기준`;
    return result.apps;
  } catch (error) {
    $('#appAdminStatus').textContent = error.message;
    if (!options.quiet) toast(error.message);
    return null;
  } finally {
    button.disabled = false;
  }
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
  $('#runCredentialLifecycle').disabled = !state.ready;
  $('#runParserRegression').disabled = !state.ready;
  $('#runKnowledgeLifecycle').disabled = !state.ready;
  $('#runKnowledgePolicyMatrix').disabled = !state.ready;
  $('#runKnowledgeIndexJob').disabled = !state.ready;
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
  if (button.dataset.tab !== 'appAdmin') dismissIssuedKey();
  document.querySelectorAll('.tab, .panel').forEach((element) => element.classList.remove('active'));
  button.classList.add('active');
  $(`#${button.dataset.tab}`).classList.add('active');
  if (button.dataset.tab === 'appAdmin') loadApps();
}));

$('#refreshApps').addEventListener('click', () => loadApps());

$('#dismissIssuedKey').addEventListener('click', dismissIssuedKey);

$('#toggleIssuedKey').addEventListener('click', () => {
  const input = $('#issuedAppkey');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#toggleIssuedKey').textContent = input.type === 'password' ? '표시' : '숨김';
});

$('#copyIssuedKey').addEventListener('click', async () => {
  const appkey = $('#issuedAppkey').value;
  if (!appkey) return;
  await navigator.clipboard.writeText(appkey);
  toast('AppKey를 클립보드에 복사했습니다. 사용 후 클립보드를 비워 주세요.');
});

$('#createAppForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#issueAppkey');
  button.disabled = true; button.textContent = '발급 중...';
  const valueOrUndefined = (selector) => $(selector).value ? Number($(selector).value) : undefined;
  try {
    const allowedAccessLevels = [...document.querySelectorAll('input[name="accessLevel"]:checked')].map((input) => input.value);
    const result = await api('/api/admin/apps', {
      method: 'POST',
      body: JSON.stringify({
        appname: $('#newAppName').value,
        appcode: $('#newAppCode').value,
        allowedAccessLevels,
        remark: $('#newAppRemark').value,
        appkeyTtlDays: valueOrUndefined('#newAppTtl'),
        maxStorageMb: valueOrUndefined('#newAppStorage'),
        monthlyTokenLimit: valueOrUndefined('#newAppTokens'),
        confirmIssue: $('#confirmAppIssue').checked,
      }),
    });
    showIssuedKey(result, 'AppKey 발급 완료');
    event.currentTarget.reset();
    await loadApps();
    toast('앱과 AppKey를 발급했습니다.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '앱 등록 및 AppKey 발급'; }
});

function closeRotateDialog() {
  $('#rotateDialog').close();
  $('#rotateAppId').value = '';
  $('#confirmRotate').checked = false;
}

$('#cancelRotate').addEventListener('click', closeRotateDialog);
$('#cancelRotateBottom').addEventListener('click', closeRotateDialog);

$('#rotateKeyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const appId = $('#rotateAppId').value;
  const button = $('#rotateAppkey');
  button.disabled = true; button.textContent = '회전 중...';
  try {
    const result = await api(`/api/admin/apps/${encodeURIComponent(appId)}/appkey`, {
      method: 'POST',
      body: JSON.stringify({
        ttlDays: Number($('#rotateTtl').value),
        gracePeriodSeconds: Number($('#rotateGrace').value),
        confirmRotate: $('#confirmRotate').checked,
      }),
    });
    closeRotateDialog();
    showIssuedKey(result, '새 AppKey 발급 완료');
    await loadApps();
    toast('AppKey를 회전했습니다.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '새 AppKey 발급'; }
});

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

$('#runCredentialLifecycle').addEventListener('click', async () => {
  const report = await runDemoAction($('#runCredentialLifecycle'), '검증 중...', () => api('/api/demo/credential-lifecycle-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) await loadDemoState();
});

$('#runParserRegression').addEventListener('click', async () => {
  const report = await runDemoAction($('#runParserRegression'), '검증 중...', () => api('/api/demo/parser-regression-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`parser 회귀: ${report.summary.passed}/${report.summary.total} PASS`);
});

$('#runKnowledgeLifecycle').addEventListener('click', async () => {
  const report = await runDemoAction($('#runKnowledgeLifecycle'), '검증 중...', () => api('/api/demo/knowledge-lifecycle-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`지식 전체 흐름: ${report.summary.passed}/${report.summary.total} PASS`);
});

$('#runKnowledgePolicyMatrix').addEventListener('click', async () => {
  const report = await runDemoAction($('#runKnowledgePolicyMatrix'), '검증 중...', () => api('/api/demo/knowledge-policy-matrix-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`지식 정책 matrix: ${report.summary.passed}/${report.summary.total} PASS`);
});

$('#runKnowledgeIndexJob').addEventListener('click', async () => {
  const report = await runDemoAction($('#runKnowledgeIndexJob'), '검증 중...', () => api('/api/demo/knowledge-index-job-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`비동기 인덱싱: ${report.summary.passed}/${report.summary.total} PASS`);
});

$('#runKnowledgeFileRejection').addEventListener('click', async () => {
  const report = await runDemoAction($('#runKnowledgeFileRejection'), '검증 중...', () => api('/api/demo/knowledge-file-rejection-validation', {
    method: 'POST',
    body: JSON.stringify({ confirmValidation: true }),
  }));
  if (report) toast(`지식 파일 거절: ${report.summary.passed}/${report.summary.total} PASS`);
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
  if (key) window.location.assign(demoUrl(`/api/download?key=${encodeURIComponent(key)}`));
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

let currentPerformance;
let baselinePerformance;
let performanceComparison;
let performanceRunning = false;
const presetSelect = $('#performancePreset');
for (const [value, preset] of Object.entries(performancePresets)) {
  const option = document.createElement('option'); option.value = value;
  option.textContent = `${preset.label} · ${preset.total}회 / 동시 ${preset.concurrency}`;
  presetSelect.append(option);
}
const customOption = document.createElement('option'); customOption.value = 'custom'; customOption.textContent = '직접 설정'; presetSelect.append(customOption);
function applyPerformancePreset() {
  const preset = performancePresets[presetSelect.value];
  $('#totalRequests').readOnly = Boolean(preset); $('#concurrency').readOnly = Boolean(preset);
  if (preset) { $('#totalRequests').value = preset.total; $('#concurrency').value = preset.concurrency; }
}
presetSelect.addEventListener('change', applyPerformancePreset); applyPerformancePreset();
function downloadPerformance(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderPerformanceComparison() {
  $('#performanceComparisonRows').replaceChildren();
  performanceComparison = null;
  $('#exportPerformanceComparison').disabled = true;
  $('#performanceComparisonNote').textContent = '';
  if (!currentPerformance || !baselinePerformance) return;
  performanceComparison = comparePerformanceReports(baselinePerformance, currentPerformance);
  const changed = performanceComparison.differences.length ? `조건 차이: ${performanceComparison.differences.join(', ')}. ` : '기록된 요청 조건이 같습니다. ';
  $('#performanceComparisonNote').textContent = changed + performanceComparison.note;
  for (const metric of performanceComparison.metrics) {
    const row = document.createElement('tr');
    for (const text of [metric.label, metric.baseline == null ? '미측정' : `${metric.baseline} ${metric.unit}`, metric.current == null ? '미측정' : `${metric.current} ${metric.unit}`, metric.delta == null ? '미측정' : `${metric.delta > 0 ? '+' : ''}${metric.delta}`, metric.changePercent == null ? '계산 불가' : `${metric.changePercent}%`]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    $('#performanceComparisonRows').append(row);
  }
  $('#exportPerformanceComparison').disabled = false;
}
function setPerformanceBaseline(report) {
  baselinePerformance = structuredClone(validatePerformanceReport(report));
  $('#performanceBaselineStatus').textContent = `기준: ${report.operationId} · ${report.startedAt ?? '시각 미기록'}`;
  renderPerformanceComparison();
}
$('#usePerformanceBaseline').addEventListener('click', () => setPerformanceBaseline(currentPerformance));
$('#performanceBaselineFile').addEventListener('change', async (event) => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('비교 리포트는 5MB 이하만 불러올 수 있습니다.');
    setPerformanceBaseline(JSON.parse(await file.text()));
  } catch (error) { toast(error.message); }
  finally { event.target.value = ''; }
});
$('#exportPerformance').addEventListener('click', () => downloadPerformance(currentPerformance, 'performance-run.json'));
$('#exportPerformanceComparison').addEventListener('click', () => downloadPerformance(performanceComparison, 'performance-comparison.json'));

$('#performanceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (performanceRunning) return;
  performanceRunning = true; $('#runPerformance').disabled = true; $('#runPerformance').textContent = '시험 실행 중…';
  try {
    const report = await api('/api/performance/run', { method: 'POST', body: JSON.stringify({ preset: presetSelect.value, operationId: $('#performanceOperation').value, total: Number($('#totalRequests').value), concurrency: Number($('#concurrency').value), body: parseJson('#performanceBody') }) });
    currentPerformance = report;
    $('#usePerformanceBaseline').disabled = false; $('#exportPerformance').disabled = false;
    renderPerformanceComparison();
    const summary = report.summary;
    const stageLabel = (value) => value?.p95 == null ? '미측정' : `${value.p95} ms (${value.measuredRequests}건)`;
    renderMetrics('#performanceSummary', [
      ['최종 HTTP 성공률', `${summary.successRate}%`], ['처리량', `${summary.throughputPerSecond}/s`],
      ['최종 실패', summary.outcomes?.failed ?? '미측정'],
      ['HTTP 429', summary.outcomes?.rateLimited ?? '미측정'],
      ['데모 타임아웃', summary.outcomes?.timeout ?? '미측정'],
      ['연결 오류', summary.outcomes?.transportError ?? '미측정'],
      ['기타 HTTP 실패', summary.outcomes?.httpError ?? '미측정'],
      ['데모 HTTP 시도', summary.retries?.attempts ?? '미측정'],
      ['데모 재시도', summary.retries?.retryCount ?? '미측정'],
      ['요청 전체 SDK 시도 p95', stageLabel(summary.awsRequest?.attempts).replace(' ms', '회')],
      ['요청 전체 SDK 재시도 p95', stageLabel(summary.awsRequest?.retryCount).replace(' ms', '회')],
      ['요청 전체 SDK 재시도 지연 p95', stageLabel(summary.awsRequest?.totalRetryDelayMs)],
      ['전체 SDK 측정 완료 응답', summary.awsRequest?.completeRequests ?? '미측정'],
      ['생성 SDK 시도 p95', stageLabel(summary.sdk?.generation?.attempts).replace(' ms', '회')],
      ['생성 SDK 재시도 지연 p95', stageLabel(summary.sdk?.generation?.totalRetryDelayMs)],
      ['실패 호출 SDK 시도 p95', stageLabel(summary.sdk?.['failed-call']?.attempts).replace(' ms', '회')],
      ['전체 p50', `${summary.latencyMs.p50} ms`], ['전체 p95', `${summary.latencyMs.p95} ms`], ['전체 p99', `${summary.latencyMs.p99} ms`],
      ['검색 p95', stageLabel(summary.timings?.retrievalMs)], ['생성 p95', stageLabel(summary.timings?.generationMs)],
      ['입력 토큰 합계', summary.tokens.input ?? '미측정'], ['출력 토큰 합계', summary.tokens.output ?? '미측정'],
      ['측정 응답당 평균 토큰', summary.tokens.averagePerRequest ?? '미측정'],
      ['토큰 측정 응답 수', summary.tokens.measuredRequests?.total ?? '미측정'],
      ['요청 maxTokens', summary.maxTokens?.requested ?? '미측정'],
      ['서버 maxTokens', summary.maxTokens?.effective?.length ? summary.maxTokens.effective.join(', ') : '미측정'],
    ]);
    $('#performanceResult').textContent = JSON.stringify(report, null, 2);
  } catch (error) { toast(error.message); }
  finally { performanceRunning = false; $('#runPerformance').disabled = false; $('#runPerformance').textContent = '성능 시험 실행'; }
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
