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

async function loadConfig() {
  const config = await api('/api/config');
  $('#baseUrl').value = config.baseUrl;
  $('#timeoutMs').value = config.timeoutMs;
  const badge = $('#connectionBadge');
  badge.textContent = `${config.baseUrl} · appkey ${config.hasAppkey ? '설정됨' : '없음'}`;
  badge.classList.toggle('ready', config.hasAppkey);
}

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab, .panel').forEach((element) => element.classList.remove('active'));
  button.classList.add('active');
  $(`#${button.dataset.tab}`).classList.add('active');
}));

$('#configForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({ baseUrl: $('#baseUrl').value, appkey: $('#appkey').value, timeoutMs: Number($('#timeoutMs').value) }) });
    $('#appkey').value = '';
    await loadConfig();
    toast('연결 설정을 저장했습니다.');
  } catch (error) { toast(error.message); }
});

$('#clearKey').addEventListener('click', async () => {
  await api('/api/config', { method: 'PUT', body: JSON.stringify({ clearAppkey: true }) });
  await loadConfig();
  toast('appkey를 제거했습니다.');
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
    const result = await api(`/api/upload?operationId=${encodeURIComponent($('#uploadOperation').value)}`, { method: 'POST', body: form });
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
  await loadConfig();
}

bootstrap().catch((error) => toast(error.message));
