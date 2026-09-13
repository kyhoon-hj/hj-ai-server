import { appsApi, ConsoleApiError, credentialsApi } from './api.js';

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

function errorMarkup(error, retry) {
  const loginPending = error instanceof ConsoleApiError && error.status === 401;
  return `<div class="error-state"><div class="state-copy"><div class="state-icon">${loginPending ? '◎' : '!'}</div><h2>${loginPending ? '개발용 Console 연결이 필요합니다' : '앱 정보를 불러오지 못했습니다'}</h2><p>${escapeHtml(loginPending ? 'HJ-Works 로그인은 마지막 기능 단계에서 연결됩니다. 현재는 로컬 fixture identity가 연결된 AI Server에서 기능을 확인할 수 있습니다.' : error.message)}</p>${error.correlationId ? `<span class="correlation">Request ${escapeHtml(error.correlationId)}</span>` : ''}<button class="button secondary" data-action="${retry}">다시 시도</button></div></div>`;
}

function loadingMarkup(rows = true) {
  if (!rows)
    return '<div class="loading-state"><div class="state-copy"><div class="state-icon">◇</div><h2>앱 정보를 불러오는 중입니다</h2><p>조직 소유권과 앱 설정을 확인하고 있습니다.</p></div></div>';
  return `<div class="panel"><div class="panel-toolbar"><div class="skeleton" style="width:260px;height:36px"></div></div>${Array.from({ length: 4 }, () => '<div style="height:73px;padding:18px;border-top:1px solid #edf0ee"><div class="skeleton" style="width:42%;height:12px"></div><div class="skeleton" style="width:28%;height:8px;margin-top:9px"></div></div>').join('')}</div>`;
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
    <div class="detail-layout"><section class="panel detail-card"><div class="detail-header"><div class="detail-title"><span class="app-glyph">◇</span><div><h1>${escapeHtml(app.appname)}</h1><p class="mono">${escapeHtml(app.appcode)}</p></div></div><span class="status ${app.status === 'active' ? '' : 'inactive'}">${app.status === 'active' ? '활성' : '비활성'}</span></div>
      <form id="detail-form" class="form-grid"><div class="form-grid two"><label><span>앱 이름</span><input name="appname" maxlength="200" required value="${escapeHtml(app.appname)}" /></label><label><span>상태</span><select name="status"><option value="active" ${app.status === 'active' ? 'selected' : ''}>활성</option><option value="inactive" ${app.status === 'inactive' ? 'selected' : ''}>비활성</option></select></label></div><label><span>앱 코드</span><input class="mono" readonly value="${escapeHtml(app.appcode)}" /><small>앱 코드는 생성 후 변경할 수 없습니다.</small></label><label><span>설명</span><textarea name="remark" maxlength="1000" rows="5" placeholder="앱의 용도와 사용 대상을 입력하세요.">${escapeHtml(app.remark ?? '')}</textarea></label><div id="detail-error" class="inline-error" hidden></div><div class="form-actions"><button class="button secondary" type="reset">변경 취소</button><button class="button primary" id="detail-submit" type="submit">변경사항 저장</button></div></form>
    </section><aside><div class="panel side-card"><h3>앱 정보</h3><p>이 조직에서 소유한 AI 애플리케이션입니다.</p><div class="info-list"><div class="info-row"><span>생성일</span><strong>${formatDate(app.createat, true)}</strong></div><div class="info-row"><span>최근 수정</span><strong>${formatDate(app.updateat, true)}</strong></div><div class="info-row"><span>API Key 만료</span><strong>${formatDate(app.appkeyExpiresAt)}</strong></div></div></div><div class="panel side-card"><h3>API Credential</h3><p>앱의 서버 전용 Key를 발급하고 안전하게 회전합니다.</p><a class="button secondary full-button" href="/console/apps/${app.id}/credentials" data-link>Key 관리 열기 →</a></div><div class="panel side-card"><h3>다음 설정</h3><div class="coming-soon">Playground와 빠른 시작 예제는 다음 구현 단계에서 연결됩니다.</div></div></aside></div>`;
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
    <nav class="detail-tabs" aria-label="앱 설정"><a href="/console/apps/${app.id}/overview" data-link>개요</a><a class="active" href="/console/apps/${app.id}/credentials" data-link>API Credential</a><span>Playground <small>다음 단계</small></span></nav>
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
  if (current.name === 'credentials') await renderCredentials(current.appId);
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
});

view.addEventListener('submit', async (event) => {
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
