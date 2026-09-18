import {
  appsApi,
  ConsoleApiError,
  credentialsApi,
  playgroundApi,
  requestLogsApi,
  usageApi,
} from './api.js';

const view = document.querySelector('#app-view');
const breadcrumb = document.querySelector('#breadcrumb-current');
const createDialog = document.querySelector('#create-dialog');
const createForm = document.querySelector('#create-form');
const createError = document.querySelector('#create-error');
const createSubmit = document.querySelector('#create-submit');
const remark = createForm.elements.remark;
const remarkCount = document.querySelector('#remark-count');
const toastRegion = document.querySelector('#toast-region');
const sidebar = document.querySelector('#sidebar');
const mobileMenu = document.querySelector('.mobile-menu');
const mobileNavBackdrop = document.querySelector('#mobile-nav-backdrop');
const credentialDialog = document.querySelector('#credential-dialog');
const credentialForm = document.querySelector('#credential-form');
const credentialError = document.querySelector('#credential-error');
const credentialSubmit = document.querySelector('#credential-submit');
const gracePeriodField = document.querySelector('#grace-period-field');
const keyRevealDialog = document.querySelector('#key-reveal-dialog');
const issuedKey = document.querySelector('#issued-key');
const copyKey = document.querySelector('#copy-key');
const keySavedConfirmation = document.querySelector('#key-saved-confirmation');
const closeKeyReveal = document.querySelector('#close-key-reveal');
const revokeDialog = document.querySelector('#revoke-dialog');
const revokeForm = document.querySelector('#revoke-form');
const revokeTarget = document.querySelector('#revoke-target');
const revokeError = document.querySelector('#revoke-error');
const revokeSubmit = document.querySelector('#revoke-submit');

const state = {
  apps: [],
  query: '',
  status: 'all',
  credentialMode: 'issue',
  credentialAppId: null,
  revokeCredentialId: null,
  usageDays: 30,
  requestLogs: [],
  requestLogApps: [],
  requestLogFilters: {
    days: 30,
    appId: '',
    status: '',
    requestId: '',
    errorCode: '',
  },
  requestLogNextCursor: null,
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function showToast(message, kind = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${kind === 'error' ? 'error' : ''}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3500);
}

function navigate(path) {
  closeMobileNavigation();
  if (window.location.pathname !== path) history.pushState({}, '', path);
  void renderRoute();
}

function closeMobileNavigation() {
  sidebar.classList.remove('open');
  mobileNavBackdrop.classList.remove('open');
  mobileMenu.setAttribute('aria-expanded', 'false');
}

function toggleMobileNavigation() {
  const open = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  mobileNavBackdrop.classList.toggle('open', open);
  mobileMenu.setAttribute('aria-expanded', String(open));
}

function setActiveNavigation(name) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    const href = item.getAttribute('href');
    item.classList.toggle(
      'active',
      name === 'usage'
        ? href === '/console/usage'
        : name === 'request-logs' || name === 'request-log-detail'
          ? href === '/console/request-logs'
          : href === '/console/apps',
    );
  });
}

function errorMarkup(error, retry) {
  const loginPending = error instanceof ConsoleApiError && error.status === 401;
  return `<div class="error-state"><div class="state-copy"><div class="state-icon">${loginPending ? '◎' : '!'}</div><h2>${loginPending ? '개발용 Console 연결이 필요합니다' : '앱 정보를 불러오지 못했습니다'}</h2><p>${escapeHtml(loginPending ? 'HJ-Works 로그인은 마지막 기능 단계에서 연결됩니다. 현재는 로컬 fixture identity가 연결된 AI Server에서 기능을 확인할 수 있습니다.' : error.message)}</p>${error.correlationId ? `<span class="correlation">Request ${escapeHtml(error.correlationId)}</span>` : ''}<button class="button secondary" data-action="${retry}">다시 시도</button></div></div>`;
}

function loadingMarkup(rows = true) {
  if (!rows)
    return '<div class="loading-state"><div class="state-copy"><div class="state-icon">◇</div><h2>앱 정보를 불러오는 중입니다</h2><p>조직 소유권과 앱 설정을 확인하고 있습니다.</p></div></div>';
  return `<div class="panel"><div class="panel-toolbar"><div class="skeleton" style="width:260px;height:36px"></div></div>${Array.from({ length: 4 }, () => '<div style="height:73px;padding:18px;border-top:1px solid #edf0ee"><div class="skeleton" style="width:42%;height:12px"></div><div class="skeleton" style="width:28%;height:8px;margin-top:9px"></div></div>').join('')}</div>`;
}

function detailTabs(appId, active) {
  const tab = (name, label, path) =>
    `<a class="${active === name ? 'active' : ''}" href="/console/apps/${appId}/${path}" data-link>${label}</a>`;
  return `<nav class="detail-tabs" aria-label="앱 설정">${tab('overview', '개요', 'overview')}${tab('credentials', 'API Credential', 'credentials')}${tab('playground', 'Playground', 'playground')}</nav>`;
}

function filteredApps() {
  const query = state.query.trim().toLocaleLowerCase('ko');
  return state.apps.filter((app) => {
    const statusMatches = state.status === 'all' || app.status === state.status;
    const queryMatches =
      !query ||
      `${app.appname} ${app.appcode} ${app.remark ?? ''}`
        .toLocaleLowerCase('ko')
        .includes(query);
    return statusMatches && queryMatches;
  });
}

function listMarkup() {
  const rows = filteredApps();
  const activeCount = state.apps.filter(
    (app) => app.status === 'active',
  ).length;
  const expiringCount = state.apps.filter((app) => {
    if (!app.appkeyExpiresAt) return false;
    const remaining = new Date(app.appkeyExpiresAt).getTime() - Date.now();
    return remaining > 0 && remaining < 30 * 24 * 60 * 60 * 1000;
  }).length;
  return `
    <div class="page-heading"><div><p class="eyebrow">APPLICATIONS</p><h1>AI 애플리케이션</h1><p>조직에서 사용하는 AI 앱과 연결 상태를 관리합니다.</p></div><button class="button primary" data-action="create">＋ 새 앱 만들기</button></div>
    <div class="summary-grid"><div class="summary-card highlight"><span>전체 앱</span><strong>${state.apps.length}</strong><small>applications</small></div><div class="summary-card"><span>활성 앱</span><strong>${activeCount}</strong><small>active</small></div><div class="summary-card"><span>30일 내 Key 만료</span><strong>${expiringCount}</strong><small>attention</small></div></div>
    <div class="panel">
      <div class="panel-toolbar"><label class="search"><span class="sr-only">앱 검색</span><input id="app-search" value="${escapeHtml(state.query)}" placeholder="이름, 앱 코드로 검색" /></label><div class="filter-group"><select id="status-filter" class="filter" aria-label="상태 필터"><option value="all" ${state.status === 'all' ? 'selected' : ''}>모든 상태</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>활성</option><option value="inactive" ${state.status === 'inactive' ? 'selected' : ''}>비활성</option></select></div></div>
      ${rows.length ? `<table class="app-table"><thead><tr><th style="width:38%">애플리케이션</th><th style="width:27%">앱 코드</th><th style="width:13%">상태</th><th style="width:18%">최근 수정</th><th style="width:4%"></th></tr></thead><tbody>${rows.map((app) => `<tr tabindex="0" data-app-id="${app.id}"><td><div class="app-name"><span class="app-glyph">◇</span><span><strong>${escapeHtml(app.appname)}</strong><small>${escapeHtml(app.remark || '설명이 없습니다.')}</small></span></div></td><td class="mono">${escapeHtml(app.appcode)}</td><td><span class="status ${app.status === 'active' ? '' : 'inactive'}">${app.status === 'active' ? '활성' : '비활성'}</span></td><td>${formatDate(app.updateat)}</td><td class="row-arrow">›</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state"><div class="state-copy"><div class="state-icon">◇</div><h2>${state.apps.length ? '검색 결과가 없습니다' : '첫 번째 AI 앱을 만들어 보세요'}</h2><p>${state.apps.length ? '검색어나 상태 필터를 변경해 다시 확인하세요.' : '앱을 만들면 API 호출에 사용할 앱 코드와 관리 공간이 생성됩니다.'}</p>${state.apps.length ? '' : '<button class="button primary" data-action="create">＋ 새 앱 만들기</button>'}</div></div>`}
    </div>`;
}

async function renderList() {
  breadcrumb.textContent = '애플리케이션';
  document.title = '애플리케이션 · HJ AI Console';
  view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">APPLICATIONS</p><h1>AI 애플리케이션</h1><p>조직에서 사용하는 AI 앱과 연결 상태를 관리합니다.</p></div></div>${loadingMarkup()}`;
  try {
    state.apps = await appsApi.list();
    view.innerHTML = listMarkup();
  } catch (error) {
    view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">APPLICATIONS</p><h1>AI 애플리케이션</h1><p>조직에서 사용하는 AI 앱과 연결 상태를 관리합니다.</p></div></div><div class="panel">${errorMarkup(error, 'reload-list')}</div>`;
  }
}

function detailMarkup(app) {
  return `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a>
    ${detailTabs(app.id, 'overview')}
    <div class="detail-layout"><section class="panel detail-card"><div class="detail-header"><div class="detail-title"><span class="app-glyph">◇</span><div><h1>${escapeHtml(app.appname)}</h1><p class="mono">${escapeHtml(app.appcode)}</p></div></div><span class="status ${app.status === 'active' ? '' : 'inactive'}">${app.status === 'active' ? '활성' : '비활성'}</span></div>
      <form id="detail-form" class="form-grid"><div class="form-grid two"><label><span>앱 이름</span><input name="appname" maxlength="200" required value="${escapeHtml(app.appname)}" /></label><label><span>상태</span><select name="status"><option value="active" ${app.status === 'active' ? 'selected' : ''}>활성</option><option value="inactive" ${app.status === 'inactive' ? 'selected' : ''}>비활성</option></select></label></div><label><span>앱 코드</span><input class="mono" readonly value="${escapeHtml(app.appcode)}" /><small>앱 코드는 생성 후 변경할 수 없습니다.</small></label><label><span>설명</span><textarea name="remark" maxlength="1000" rows="5" placeholder="앱의 용도와 사용 대상을 입력하세요.">${escapeHtml(app.remark ?? '')}</textarea></label><div id="detail-error" class="inline-error" hidden></div><div class="form-actions"><button class="button secondary" type="reset">변경 취소</button><button class="button primary" id="detail-submit" type="submit">변경사항 저장</button></div></form>
    </section><aside><div class="panel side-card"><h3>앱 정보</h3><p>이 조직에서 소유한 AI 애플리케이션입니다.</p><div class="info-list"><div class="info-row"><span>생성일</span><strong>${formatDate(app.createat, true)}</strong></div><div class="info-row"><span>최근 수정</span><strong>${formatDate(app.updateat, true)}</strong></div><div class="info-row"><span>API Key 만료</span><strong>${formatDate(app.appkeyExpiresAt)}</strong></div></div></div><div class="panel side-card"><h3>API Credential</h3><p>앱의 서버 전용 Key를 발급하고 안전하게 회전합니다.</p><a class="button secondary full-button" href="/console/apps/${app.id}/credentials" data-link>Key 관리 열기 →</a></div><div class="panel side-card"><h3>API 테스트</h3><p>발급한 Key로 지식 기반 답변을 바로 실행합니다.</p><a class="button secondary full-button" href="/console/apps/${app.id}/playground" data-link>Playground 열기 →</a></div></aside></div>`;
}

async function renderDetail(appId) {
  breadcrumb.textContent = '앱 상세';
  document.title = '앱 상세 · HJ AI Console';
  view.innerHTML = `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a><div class="panel">${loadingMarkup(false)}</div>`;
  try {
    const app = await appsApi.get(appId);
    document.title = `${app.appname} · HJ AI Console`;
    view.innerHTML = detailMarkup(app);
  } catch (error) {
    view.innerHTML = `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a><div class="panel">${errorMarkup(error, 'reload-detail')}</div>`;
  }
}

function shortId(value) {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—';
}

function credentialCard(credential) {
  const expired = credential.status === 'expired';
  const slotLabel = credential.slot === 'current' ? '현재 Key' : '이전 Key';
  return `<article class="credential-card"><div class="credential-card-header"><div><span class="credential-slot">${slotLabel}</span><h3 class="mono">${escapeHtml(shortId(credential.id))}</h3></div><span class="status ${expired ? 'inactive' : ''}">${expired ? '만료됨' : '활성'}</span></div><dl class="credential-metadata"><div><dt>발급일</dt><dd>${formatDate(credential.issuedAt, true)}</dd></div><div><dt>마지막 사용</dt><dd>${credential.lastUsedAt ? formatDate(credential.lastUsedAt, true) : '사용 기록 없음'}</dd></div><div><dt>${credential.slot === 'previous' ? '유예 종료' : '만료일'}</dt><dd>${formatDate(credential.expiresAt, true)}</dd></div><div><dt>발급자</dt><dd class="mono">${escapeHtml(shortId(credential.issuedByIdentityId))}</dd></div></dl><div class="credential-actions">${credential.slot === 'current' ? '<button class="button secondary" data-action="rotate-credential">Key 회전</button>' : ''}<button class="button danger ghost-danger" data-action="revoke-credential" data-credential-id="${credential.id}">폐기</button></div></article>`;
}

function credentialsMarkup(app, credentials) {
  const hasCurrent = credentials.some(
    (credential) => credential.slot === 'current',
  );
  return `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a>
    <div class="credential-heading"><div class="detail-title"><span class="app-glyph">◇</span><div><p class="eyebrow">API CREDENTIALS</p><h1>${escapeHtml(app.appname)}</h1><p class="mono">${escapeHtml(app.appcode)}</p></div></div>${hasCurrent ? '<button class="button primary" data-action="rotate-credential">↻ Key 회전</button>' : '<button class="button primary" data-action="issue-credential">＋ 첫 Key 발급</button>'}</div>
    ${detailTabs(app.id, 'credentials')}
    <section class="panel credentials-panel"><div class="credentials-intro"><div><h2>API Key</h2><p>서버에서 AI API를 호출할 때 사용하는 비밀 Key입니다. 원문은 발급 직후 한 번만 표시됩니다.</p></div><span class="security-chip">브라우저 저장 안 함</span></div>${credentials.length ? `<div class="credential-grid">${credentials.map(credentialCard).join('')}</div>` : '<div class="empty-state credential-empty"><div class="state-copy"><div class="state-icon">⌁</div><h2>발급된 API Key가 없습니다</h2><p>첫 Key를 발급하면 원문을 한 번 확인한 뒤 서버 측 secret manager에 저장할 수 있습니다.</p><button class="button primary" data-action="issue-credential">＋ 첫 Key 발급</button></div></div>'}</section>
    <div class="credential-guidance"><div><strong>Key 원문은 복구할 수 없습니다</strong><span>분실하거나 노출된 경우 기존 Key를 폐기하고 새 Key로 회전하세요.</span></div><div><strong>회전 중 무중단 전환</strong><span>유예기간을 설정하면 이전 Key로 실행 중인 서비스를 안전하게 교체할 수 있습니다.</span></div></div>`;
}

async function renderCredentials(appId) {
  breadcrumb.textContent = 'API Credential';
  document.title = 'API Credential · HJ AI Console';
  view.innerHTML = `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a><div class="panel">${loadingMarkup(false)}</div>`;
  try {
    const [app, credentials] = await Promise.all([
      appsApi.get(appId),
      credentialsApi.list(appId),
    ]);
    document.title = `${app.appname} API Key · HJ AI Console`;
    view.innerHTML = credentialsMarkup(app, credentials);
  } catch (error) {
    view.innerHTML = `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a><div class="panel">${errorMarkup(error, 'reload-credentials')}</div>`;
  }
}

function quickstartMarkup(app) {
  const body = JSON.stringify(
    {
      query: '등록된 자료를 기준으로 답변해 주세요.',
      strict: true,
      includeSources: true,
      answerStyle: 'concise',
    },
    null,
    2,
  );
  const endpoint = 'https://YOUR_API_HOST/knowledge/answers';
  const curl = `curl -X POST "${endpoint}" \\\n  -H "Content-Type: application/json" \\\n  -H "appkey: YOUR_API_KEY" \\\n  -d '${body.replaceAll("'", "'\\''")}'`;
  const javascript = `const response = await fetch('${endpoint}', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    appkey: process.env.HJ_AI_APPKEY,\n  },\n  body: JSON.stringify(${body}),\n});\n\nconst result = await response.json();`;
  const python = `import os\nimport requests\n\nresponse = requests.post(\n    '${endpoint}',\n    headers={'appkey': os.environ['HJ_AI_APPKEY']},\n    json=${body.replaceAll('true', 'True')},\n    timeout=60,\n)\nresult = response.json()`;
  return `<section class="panel quickstart-panel"><div class="credentials-intro"><div><h2>빠른 시작</h2><p>${escapeHtml(app.appname)} 연동에 사용할 서버 측 호출 예제입니다. 실제 Key는 환경변수나 secret manager에서 읽으세요.</p></div><span class="security-chip">Key 포함 안 함</span></div><div class="quickstart-grid"><article><h3>cURL</h3><pre><code>${escapeHtml(curl)}</code></pre></article><article><h3>JavaScript</h3><pre><code>${escapeHtml(javascript)}</code></pre></article><article><h3>Python</h3><pre><code>${escapeHtml(python)}</code></pre></article></div></section>`;
}

function playgroundMarkup(app) {
  return `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a>
    <div class="credential-heading"><div class="detail-title"><span class="app-glyph">▷</span><div><p class="eyebrow">PLAYGROUND</p><h1>${escapeHtml(app.appname)}</h1><p class="mono">${escapeHtml(app.appcode)}</p></div></div><span class="security-chip">입력 Key 저장 안 함</span></div>
    ${detailTabs(app.id, 'playground')}
    <div class="playground-grid"><section class="panel playground-request"><div class="credentials-intro"><div><h2>지식 기반 답변 실행</h2><p>현재 앱의 Key로 실제 <span class="mono">/knowledge/answers</span> API를 호출합니다.</p></div></div><form id="playground-form" class="form-grid"><label><span>API Key <b>*</b></span><input name="appkey" type="password" required autocomplete="off" spellcheck="false" placeholder="발급 시 복사한 API Key" /><small>Key는 이 입력란의 메모리에만 유지되며 저장되지 않습니다.</small></label><label><span>질문 <b>*</b></span><textarea name="query" required maxlength="4000" rows="6" placeholder="등록된 지식에 대해 질문하세요."></textarea></label><div class="form-grid two"><label><span>답변 형식</span><select name="answerStyle"><option value="concise">간결하게</option><option value="detailed">상세하게</option><option value="report">보고서 형식</option></select></label><label><span>검색 개수</span><select name="limit"><option value="3">3개</option><option value="5" selected>5개</option><option value="10">10개</option></select></label></div><div class="playground-options"><label><input name="strict" type="checkbox" checked /><span>근거가 없으면 답변하지 않기</span></label><label><input name="includeSources" type="checkbox" checked /><span>출처 포함</span></label></div><div id="playground-error" class="inline-error" hidden></div><div class="form-actions"><button class="button secondary" type="reset">초기화</button><button class="button primary" id="playground-submit" type="submit">▷ 답변 실행</button></div></form></section><section class="panel playground-response" aria-live="polite"><div class="playground-placeholder"><span>◇</span><h2>실행 결과</h2><p>질문을 실행하면 답변, 판정, 출처와 처리시간이 여기에 표시됩니다.</p></div></section></div>
    ${quickstartMarkup(app)}`;
}

async function renderPlayground(appId) {
  breadcrumb.textContent = 'Playground';
  document.title = 'Playground · HJ AI Console';
  view.innerHTML = `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a><div class="panel">${loadingMarkup(false)}</div>`;
  try {
    const app = await appsApi.get(appId);
    document.title = `${app.appname} Playground · HJ AI Console`;
    view.innerHTML = playgroundMarkup(app);
  } catch (error) {
    view.innerHTML = `<a class="detail-back" href="/console/apps" data-link>← 애플리케이션으로 돌아가기</a><div class="panel">${errorMarkup(error, 'reload-playground')}</div>`;
  }
}

function metricValue(measurement, suffix = '') {
  return measurement?.value === null || measurement?.value === undefined
    ? '미측정'
    : `${Number(measurement.value).toLocaleString()}${suffix}`;
}

function usageMarkup(summary, timeseries, breakdown) {
  const maxRequests = Math.max(
    1,
    ...timeseries.points.map((point) => point.requestCount),
  );
  const chart = timeseries.points
    .map(
      (point) =>
        `<div class="usage-bar-item" title="${escapeHtml(point.date)} · ${point.requestCount.toLocaleString()}건"><div class="usage-bar-track"><i style="height:${Math.max(point.requestCount ? 5 : 0, (point.requestCount / maxRequests) * 100)}%"></i></div><span>${escapeHtml(point.date.slice(5).replace('-', '/'))}</span></div>`,
    )
    .join('');
  const rows = breakdown.apps
    .map(
      (app) =>
        `<tr><td><div class="app-name"><span class="app-glyph">◇</span><span><strong>${escapeHtml(app.appname)}</strong><small class="mono">${escapeHtml(app.appcode)}</small></span></div></td><td>${app.requestCount.toLocaleString()}</td><td>${metricValue(app.tokens.total)}</td><td>${app.embeddings.operations.toLocaleString()}</td><td>${app.latency.averageMs === null ? '미측정' : `${app.latency.averageMs.toLocaleString()} ms`}</td></tr>`,
    )
    .join('');
  const unmeasuredTokens =
    summary.requestCount - summary.tokens.total.measuredRequests;
  return `<div class="page-heading"><div><p class="eyebrow">USAGE</p><h1>사용량</h1><p>조직 소유 앱의 요청, token, embedding과 응답 지연을 확인합니다.</p></div><label class="range-select"><span>조회 기간</span><select id="usage-range"><option value="7" ${state.usageDays === 7 ? 'selected' : ''}>최근 7일</option><option value="30" ${state.usageDays === 30 ? 'selected' : ''}>최근 30일</option><option value="90" ${state.usageDays === 90 ? 'selected' : ''}>최근 90일</option></select></label></div>
    <div class="summary-grid usage-summary"><div class="summary-card highlight"><span>전체 요청</span><strong>${summary.requestCount.toLocaleString()}</strong><small>${summary.appCount.toLocaleString()} applications</small></div><div class="summary-card"><span>성공률</span><strong>${summary.outcome.successRate === null ? '미측정' : `${summary.outcome.successRate.toLocaleString()}%`}</strong><small>${summary.outcome.measuredRequests.toLocaleString()} measured requests</small></div><div class="summary-card"><span>총 Token</span><strong>${metricValue(summary.tokens.total)}</strong><small>${unmeasuredTokens ? `${unmeasuredTokens.toLocaleString()}건 미측정` : 'all measured'}</small></div><div class="summary-card"><span>Embedding</span><strong>${summary.embeddings.operations.toLocaleString()}</strong><small>index ${summary.embeddings.indexOperations.toLocaleString()} · search ${summary.embeddings.searchOperations.toLocaleString()}</small></div><div class="summary-card"><span>평균 지연</span><strong>${summary.latency.averageMs === null ? '미측정' : `${summary.latency.averageMs.toLocaleString()} ms`}</strong><small>${summary.latency.measuredRequests.toLocaleString()} measured requests</small></div></div>
    <section class="panel usage-chart-panel"><div class="credentials-intro"><div><h2>일별 요청</h2><p>UTC 날짜를 기준으로 집계합니다. 요청이 없는 날은 0으로 표시됩니다.</p></div><span class="security-chip">질문 원문 제외</span></div><div class="usage-chart" role="img" aria-label="일별 요청 수 막대 차트">${chart}</div></section>
    <section class="panel usage-breakdown"><div class="credentials-intro"><div><h2>앱별 사용량</h2><p>현재 조직이 소유한 앱만 집계합니다.</p></div></div>${rows ? `<div class="table-scroll"><table class="app-table"><thead><tr><th>애플리케이션</th><th>요청</th><th>Token</th><th>Embedding</th><th>평균 지연</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><div class="state-copy"><h2>집계할 앱이 없습니다</h2><p>앱을 생성하고 API 요청을 실행하면 사용량이 표시됩니다.</p></div></div>'}</section>`;
}

async function renderUsage() {
  breadcrumb.textContent = '사용량';
  document.title = '사용량 · HJ AI Console';
  view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">USAGE</p><h1>사용량</h1><p>조직 소유 앱의 사용량을 집계하고 있습니다.</p></div></div>${loadingMarkup()}`;
  try {
    const [summary, timeseries, breakdown] = await Promise.all([
      usageApi.summary(state.usageDays),
      usageApi.timeseries(state.usageDays),
      usageApi.breakdown(state.usageDays),
    ]);
    view.innerHTML = usageMarkup(summary, timeseries, breakdown);
  } catch (error) {
    view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">USAGE</p><h1>사용량</h1></div></div><div class="panel">${errorMarkup(error, 'reload-usage')}</div>`;
  }
}

function requestLogListMarkup() {
  const filters = state.requestLogFilters;
  const rows = state.requestLogs
    .map(
      (log) =>
        `<tr tabindex="0" data-log-id="${escapeHtml(log.id)}"><td><strong>${formatDate(log.occurredAt, true)}</strong><small class="mono">${escapeHtml(log.requestId ?? 'Request ID 미측정')}</small></td><td><strong>${escapeHtml(log.app.appname)}</strong><small class="mono">${escapeHtml(log.app.appcode)}</small></td><td><span class="mono">${escapeHtml(log.endpoint)}</span><small>${log.source === 'knowledge' ? '지식 답변' : 'Bedrock 호출'}</small></td><td><span class="status ${log.status === 'success' ? '' : 'danger'}">${log.status === 'success' ? '성공' : '실패'}</span><small>${escapeHtml(log.errorCode ?? log.result)}</small></td><td>${log.latencyMs === null ? '미측정' : `${Number(log.latencyMs).toLocaleString()} ms`}</td><td>${log.tokens.total === null ? '미측정' : Number(log.tokens.total).toLocaleString()}</td><td class="row-arrow">›</td></tr>`,
    )
    .join('');
  const appOptions = state.requestLogApps
    .map(
      (app) =>
        `<option value="${app.id}" ${filters.appId === app.id ? 'selected' : ''}>${escapeHtml(app.appname)}</option>`,
    )
    .join('');
  return `<div class="page-heading"><div><p class="eyebrow">REQUEST LOGS</p><h1>요청 로그</h1><p>조직 소유 앱의 실행 결과를 원문 없이 진단합니다.</p></div><span class="security-chip">질문·응답 원문 제외</span></div>
    <section class="panel request-log-panel"><form id="request-log-filters" class="request-log-filters"><label><span>조회 기간</span><select name="days"><option value="7" ${filters.days === 7 ? 'selected' : ''}>최근 7일</option><option value="30" ${filters.days === 30 ? 'selected' : ''}>최근 30일</option><option value="90" ${filters.days === 90 ? 'selected' : ''}>최근 90일</option></select></label><label><span>애플리케이션</span><select name="appId"><option value="">모든 앱</option>${appOptions}</select></label><label><span>상태</span><select name="status"><option value="">모든 상태</option><option value="success" ${filters.status === 'success' ? 'selected' : ''}>성공</option><option value="failed" ${filters.status === 'failed' ? 'selected' : ''}>실패</option></select></label><label class="request-id-filter"><span>Request ID</span><input name="requestId" value="${escapeHtml(filters.requestId)}" placeholder="정확한 Request ID" /></label><label><span>오류 코드</span><input name="errorCode" value="${escapeHtml(filters.errorCode)}" placeholder="UPSTREAM_TIMEOUT" /></label><div class="request-log-actions"><button class="button primary" type="submit">조회</button><a class="button secondary" href="${requestLogsApi.exportUrl(filters)}" download>CSV 내보내기</a></div></form>
      ${rows ? `<div class="table-scroll"><table class="app-table request-log-table"><thead><tr><th>발생 시각</th><th>애플리케이션</th><th>Endpoint</th><th>결과</th><th>지연</th><th>Token</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${state.requestLogNextCursor ? '<div class="load-more"><button class="button secondary" data-action="load-more-request-logs">더 보기</button></div>' : ''}` : '<div class="empty-state"><div class="state-copy"><div class="state-icon">≡</div><h2>조건에 맞는 요청이 없습니다</h2><p>필터를 변경하거나 앱에서 API 요청을 실행해 보세요.</p></div></div>'}
    </section>`;
}

async function loadRequestLogs(append = false) {
  const result = await requestLogsApi.list({
    ...state.requestLogFilters,
    limit: 25,
    ...(append && state.requestLogNextCursor
      ? { cursor: state.requestLogNextCursor }
      : {}),
  });
  state.requestLogs = append
    ? [...state.requestLogs, ...result.items]
    : result.items;
  state.requestLogNextCursor = result.nextCursor;
}

async function renderRequestLogs() {
  breadcrumb.textContent = '요청 로그';
  document.title = '요청 로그 · HJ AI Console';
  view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">REQUEST LOGS</p><h1>요청 로그</h1><p>조직 범위 요청을 불러오고 있습니다.</p></div></div>${loadingMarkup()}`;
  try {
    if (!state.requestLogApps.length) {
      state.requestLogApps = await appsApi.list();
    }
    await loadRequestLogs();
    view.innerHTML = requestLogListMarkup();
  } catch (error) {
    view.innerHTML = `<div class="page-heading"><div><p class="eyebrow">REQUEST LOGS</p><h1>요청 로그</h1></div></div><div class="panel">${errorMarkup(error, 'reload-request-logs')}</div>`;
  }
}

function requestLogDetailMarkup(log) {
  const execution = log.execution
    ? `<pre><code>${escapeHtml(JSON.stringify(log.execution, null, 2))}</code></pre>`
    : '<p class="muted-copy">수집된 실행 metadata가 없습니다.</p>';
  return `<a class="detail-back" href="/console/request-logs" data-link>← 요청 로그로 돌아가기</a>
    <div class="credential-heading"><div class="detail-title"><span class="app-glyph">≡</span><div><p class="eyebrow">REQUEST DETAIL</p><h1>${escapeHtml(log.app.appname)}</h1><p class="mono">${escapeHtml(log.requestId ?? log.id)}</p></div></div><span class="status ${log.status === 'success' ? '' : 'danger'}">${log.status === 'success' ? '성공' : '실패'}</span></div>
    <div class="request-log-detail-grid"><section class="panel detail-card"><h2>실행 정보</h2><dl class="request-log-metadata"><div><dt>발생 시각</dt><dd>${formatDate(log.occurredAt, true)}</dd></div><div><dt>Endpoint</dt><dd class="mono">${escapeHtml(log.endpoint)}</dd></div><div><dt>결과</dt><dd>${escapeHtml(log.result)}</dd></div><div><dt>오류 코드</dt><dd class="mono">${escapeHtml(log.errorCode ?? '—')}</dd></div><div><dt>실패 단계</dt><dd>${escapeHtml(log.failureStage ?? '—')}</dd></div><div><dt>모델</dt><dd class="mono">${escapeHtml(log.modelId ?? '미측정')}</dd></div><div><dt>Embedding 모델</dt><dd class="mono">${escapeHtml(log.embeddingModel ?? '미측정')}</dd></div><div><dt>응답 지연</dt><dd>${log.latencyMs === null ? '미측정' : `${Number(log.latencyMs).toLocaleString()} ms`}</dd></div><div><dt>검색 결과</dt><dd>${Number(log.matchedChunkCount).toLocaleString()}개</dd></div></dl></section>
      <aside><section class="panel side-card"><h3>Token</h3><div class="info-list"><div class="info-row"><span>Input</span><strong>${log.tokens.input === null ? '미측정' : Number(log.tokens.input).toLocaleString()}</strong></div><div class="info-row"><span>Output</span><strong>${log.tokens.output === null ? '미측정' : Number(log.tokens.output).toLocaleString()}</strong></div><div class="info-row"><span>Total</span><strong>${log.tokens.total === null ? '미측정' : Number(log.tokens.total).toLocaleString()}</strong></div></div></section><section class="panel side-card"><h3>콘텐츠 보호</h3><p>질문과 응답 원문은 Console API에서 반환하지 않습니다.</p><span class="security-chip">metadata only</span></section></aside>
    </div><section class="panel execution-panel"><div class="credentials-intro"><div><h2>실행 Metadata</h2><p>허용된 진단 필드만 표시합니다.</p></div></div>${execution}</section>`;
}

async function renderRequestLogDetail(logId) {
  breadcrumb.textContent = '요청 로그 상세';
  document.title = '요청 로그 상세 · HJ AI Console';
  view.innerHTML = `<a class="detail-back" href="/console/request-logs" data-link>← 요청 로그로 돌아가기</a><div class="panel">${loadingMarkup(false)}</div>`;
  try {
    const log = await requestLogsApi.get(logId);
    view.innerHTML = requestLogDetailMarkup(log);
  } catch (error) {
    view.innerHTML = `<a class="detail-back" href="/console/request-logs" data-link>← 요청 로그로 돌아가기</a><div class="panel">${errorMarkup(error, 'reload-request-log-detail')}</div>`;
  }
}

function renderPlaygroundResult(result, elapsedMs) {
  const target = document.querySelector('.playground-response');
  if (!target) return;
  const sources = Array.isArray(result.sources) ? result.sources : [];
  target.innerHTML = `<div class="response-heading"><div><p class="eyebrow">RESULT</p><h2>${result.answerable ? '답변 완료' : '답변 불가'}</h2></div><span class="status ${result.answerable ? '' : 'inactive'}">${escapeHtml(result.answerStatus ?? 'unknown')}</span></div><div class="answer-copy">${escapeHtml(result.answer ?? result.response ?? '응답 내용이 없습니다.')}</div><dl class="response-metrics"><div><dt>전체 처리</dt><dd>${Number(result.latencyMs ?? elapsedMs).toLocaleString()} ms</dd></div><div><dt>검색 결과</dt><dd>${Number(result.retrieval?.count ?? sources.length)}개</dd></div><div><dt>Request ID</dt><dd class="mono">${escapeHtml(result.requestId ?? '—')}</dd></div></dl><div class="source-list"><h3>사용한 출처</h3>${sources.length ? sources.map((source) => `<article><strong>${escapeHtml(source.fileName ?? source.title ?? `출처 ${source.index}`)}</strong><span>유사도 ${Number(source.score ?? 0).toFixed(3)}</span>${source.content ? `<p>${escapeHtml(source.content)}</p>` : ''}</article>`).join('') : '<p class="muted-copy">응답에 포함된 출처가 없습니다.</p>'}</div>`;
}

function openCredentialDialog(mode, appId) {
  state.credentialMode = mode;
  state.credentialAppId = appId;
  credentialForm.reset();
  credentialError.hidden = true;
  gracePeriodField.hidden = mode !== 'rotate';
  document.querySelector('#credential-dialog-eyebrow').textContent =
    mode === 'rotate' ? 'ROTATE CREDENTIAL' : 'NEW CREDENTIAL';
  document.querySelector('#credential-dialog-title').textContent =
    mode === 'rotate' ? 'API Key 회전' : '새 API Key 발급';
  document.querySelector('#credential-dialog-description').textContent =
    mode === 'rotate'
      ? '새 Key를 발급하고 이전 Key의 유예기간을 설정합니다.'
      : 'Key 원문은 발급 직후 한 번만 표시됩니다.';
  credentialSubmit.textContent = mode === 'rotate' ? '새 Key 발급' : 'Key 발급';
  credentialDialog.showModal();
}

function showIssuedKey(value) {
  issuedKey.value = value;
  keySavedConfirmation.checked = false;
  closeKeyReveal.disabled = true;
  copyKey.textContent = '복사';
  keyRevealDialog.showModal();
}

function openRevokeDialog(appId, credentialId) {
  state.credentialAppId = appId;
  state.revokeCredentialId = credentialId;
  revokeTarget.textContent = credentialId;
  revokeError.hidden = true;
  revokeDialog.showModal();
}

function route() {
  const requestLogDetail = window.location.pathname.match(
    /^\/console\/request-logs\/(.+)\/?$/i,
  );
  if (requestLogDetail) {
    return {
      name: 'request-log-detail',
      logId: decodeURIComponent(requestLogDetail[1].replace(/\/$/, '')),
    };
  }
  if (/^\/console\/request-logs\/?$/i.test(window.location.pathname)) {
    return { name: 'request-logs' };
  }
  if (/^\/console\/usage\/?$/i.test(window.location.pathname)) {
    return { name: 'usage' };
  }
  const playground = window.location.pathname.match(
    /^\/console\/apps\/([0-9a-f-]+)\/playground\/?$/i,
  );
  if (playground) return { name: 'playground', appId: playground[1] };
  const credentials = window.location.pathname.match(
    /^\/console\/apps\/([0-9a-f-]+)\/credentials\/?$/i,
  );
  if (credentials) return { name: 'credentials', appId: credentials[1] };
  const detail = window.location.pathname.match(
    /^\/console\/apps\/([0-9a-f-]+)\/overview\/?$/i,
  );
  return detail ? { name: 'detail', appId: detail[1] } : { name: 'list' };
}

async function renderRoute() {
  const current = route();
  setActiveNavigation(current.name);
  if (current.name === 'request-log-detail')
    await renderRequestLogDetail(current.logId);
  else if (current.name === 'request-logs') await renderRequestLogs();
  else if (current.name === 'usage') await renderUsage();
  else if (current.name === 'playground') await renderPlayground(current.appId);
  else if (current.name === 'credentials')
    await renderCredentials(current.appId);
  else if (current.name === 'detail') await renderDetail(current.appId);
  else await renderList();
}

view.addEventListener('click', (event) => {
  const link = event.target.closest('[data-link]');
  if (link) {
    event.preventDefault();
    navigate(link.getAttribute('href'));
    return;
  }
  const row = event.target.closest('[data-app-id]');
  if (row) {
    navigate(`/console/apps/${row.dataset.appId}/overview`);
    return;
  }
  const logRow = event.target.closest('[data-log-id]');
  if (logRow) {
    navigate(
      `/console/request-logs/${encodeURIComponent(logRow.dataset.logId)}`,
    );
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'create') {
    createError.hidden = true;
    createForm.reset();
    remarkCount.textContent = '0';
    createDialog.showModal();
  }
  if (action === 'reload-list') void renderList();
  if (action === 'reload-detail') void renderRoute();
  if (action === 'reload-credentials') void renderRoute();
  if (action === 'reload-playground') void renderRoute();
  if (action === 'reload-usage') void renderRoute();
  if (action === 'reload-request-logs') void renderRoute();
  if (action === 'reload-request-log-detail') void renderRoute();
  if (action === 'load-more-request-logs') {
    const button = event.target.closest('button');
    button.disabled = true;
    loadRequestLogs(true)
      .then(() => {
        view.innerHTML = requestLogListMarkup();
      })
      .catch((error) => showToast(error.message, 'error'));
  }
  if (action === 'issue-credential') {
    const current = route();
    if (current.name === 'credentials')
      openCredentialDialog('issue', current.appId);
  }
  if (action === 'rotate-credential') {
    const current = route();
    if (current.name === 'credentials')
      openCredentialDialog('rotate', current.appId);
  }
  if (action === 'revoke-credential') {
    const current = route();
    if (current.name === 'credentials')
      openRevokeDialog(
        current.appId,
        event.target.closest('[data-credential-id]').dataset.credentialId,
      );
  }
});

view.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('[data-app-id]'))
    event.target.click();
});

view.addEventListener('input', (event) => {
  if (event.target.id === 'app-search') {
    state.query = event.target.value;
    view.innerHTML = listMarkup();
    document.querySelector('#app-search')?.focus();
  }
});
view.addEventListener('change', (event) => {
  if (event.target.id === 'status-filter') {
    state.status = event.target.value;
    view.innerHTML = listMarkup();
  }
  if (event.target.id === 'usage-range') {
    state.usageDays = Number(event.target.value);
    void renderUsage();
  }
});

view.addEventListener('submit', async (event) => {
  if (event.target.id === 'request-log-filters') {
    event.preventDefault();
    const data = new FormData(event.target);
    state.requestLogFilters = {
      days: Number(data.get('days')),
      appId: data.get('appId'),
      status: data.get('status'),
      requestId: data.get('requestId').trim(),
      errorCode: data.get('errorCode').trim().toUpperCase(),
    };
    view.innerHTML = `${requestLogListMarkup()}<div class="loading-overlay">조회 중…</div>`;
    try {
      await loadRequestLogs();
      view.innerHTML = requestLogListMarkup();
    } catch (error) {
      showToast(error.message, 'error');
      view.innerHTML = requestLogListMarkup();
    }
    return;
  }
  if (event.target.id === 'playground-form') {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('#playground-submit');
    const errorBox = form.querySelector('#playground-error');
    const responsePanel = document.querySelector('.playground-response');
    submit.disabled = true;
    submit.textContent = '답변 생성 중…';
    errorBox.hidden = true;
    responsePanel.innerHTML =
      '<div class="playground-placeholder"><span class="spinner">◇</span><h2>답변을 생성하고 있습니다</h2><p>지식 검색과 모델 응답을 기다리는 중입니다.</p></div>';
    const startedAt = performance.now();
    try {
      const data = new FormData(form);
      const result = await playgroundApi.answer(data.get('appkey'), {
        query: data.get('query').trim(),
        answerStyle: data.get('answerStyle'),
        limit: Number(data.get('limit')),
        strict: data.has('strict'),
        includeSources: data.has('includeSources'),
        includeSourceContent: false,
      });
      renderPlaygroundResult(result, Math.round(performance.now() - startedAt));
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      responsePanel.innerHTML = `<div class="playground-placeholder error-placeholder"><span>!</span><h2>실행하지 못했습니다</h2><p>${escapeHtml(error.message)}</p>${error.correlationId ? `<small class="correlation">Request ${escapeHtml(error.correlationId)}</small>` : ''}</div>`;
    } finally {
      submit.disabled = false;
      submit.textContent = '▷ 답변 실행';
    }
    return;
  }
  if (event.target.id !== 'detail-form') return;
  event.preventDefault();
  const current = route();
  if (current.name !== 'detail') return;
  const form = event.target;
  const submit = form.querySelector('#detail-submit');
  const errorBox = form.querySelector('#detail-error');
  submit.disabled = true;
  submit.textContent = '저장 중…';
  errorBox.hidden = true;
  try {
    const data = new FormData(form);
    await appsApi.update(current.appId, {
      appname: data.get('appname').trim(),
      remark: data.get('remark').trim(),
      status: data.get('status'),
    });
    showToast('앱 설정을 저장했습니다.');
    await renderDetail(current.appId);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    submit.disabled = false;
    submit.textContent = '변경사항 저장';
  }
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  createSubmit.disabled = true;
  createSubmit.textContent = '생성 중…';
  createError.hidden = true;
  try {
    const data = new FormData(createForm);
    const app = await appsApi.create({
      appname: data.get('appname').trim(),
      remark: data.get('remark').trim() || undefined,
    });
    createDialog.close();
    showToast('새 AI 앱을 만들었습니다.');
    navigate(`/console/apps/${app.id}/overview`);
  } catch (error) {
    createError.textContent = error.message;
    createError.hidden = false;
  } finally {
    createSubmit.disabled = false;
    createSubmit.textContent = '앱 만들기';
  }
});

credentialForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.credentialAppId) return;
  credentialSubmit.disabled = true;
  credentialSubmit.textContent = '발급 중…';
  credentialError.hidden = true;
  try {
    const data = new FormData(credentialForm);
    const input = { ttlDays: Number(data.get('ttlDays')) };
    if (state.credentialMode === 'rotate') {
      input.gracePeriodSeconds = Number(data.get('gracePeriodSeconds'));
    }
    const appId = state.credentialAppId;
    const result =
      state.credentialMode === 'rotate'
        ? await credentialsApi.rotate(appId, input)
        : await credentialsApi.issue(appId, input);
    credentialDialog.close();
    showIssuedKey(result.appkey);
    await renderCredentials(appId);
  } catch (error) {
    credentialError.textContent = error.message;
    credentialError.hidden = false;
  } finally {
    credentialSubmit.disabled = false;
    credentialSubmit.textContent =
      state.credentialMode === 'rotate' ? '새 Key 발급' : 'Key 발급';
  }
});

revokeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.credentialAppId || !state.revokeCredentialId) return;
  revokeSubmit.disabled = true;
  revokeSubmit.textContent = '폐기 중…';
  revokeError.hidden = true;
  try {
    const appId = state.credentialAppId;
    await credentialsApi.revoke(appId, state.revokeCredentialId);
    revokeDialog.close();
    state.revokeCredentialId = null;
    showToast('API Key를 폐기했습니다.');
    await renderCredentials(appId);
  } catch (error) {
    revokeError.textContent = error.message;
    revokeError.hidden = false;
  } finally {
    revokeSubmit.disabled = false;
    revokeSubmit.textContent = 'Key 폐기';
  }
});

copyKey.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(issuedKey.value);
    copyKey.textContent = '복사됨 ✓';
  } catch {
    issuedKey.select();
    document.execCommand('copy');
    copyKey.textContent = '복사됨 ✓';
  }
});
keySavedConfirmation.addEventListener('change', () => {
  closeKeyReveal.disabled = !keySavedConfirmation.checked;
});
keyRevealDialog.addEventListener('cancel', (event) => event.preventDefault());
keyRevealDialog.addEventListener('close', () => {
  issuedKey.value = '';
  keySavedConfirmation.checked = false;
  closeKeyReveal.disabled = true;
});

remark.addEventListener('input', () => {
  remarkCount.textContent = String(remark.value.length);
});
mobileMenu.addEventListener('click', toggleMobileNavigation);
mobileNavBackdrop.addEventListener('click', closeMobileNavigation);
document.addEventListener('click', (event) => {
  const closeTarget = event.target.closest('[data-dialog-close]');
  if (closeTarget) {
    document.querySelector(`#${closeTarget.dataset.dialogClose}`)?.close();
    return;
  }
  const link = event.target.closest('[data-link]');
  if (link && !view.contains(link)) {
    event.preventDefault();
    navigate(link.getAttribute('href'));
  }
});
window.addEventListener('popstate', () => void renderRoute());
void renderRoute();
