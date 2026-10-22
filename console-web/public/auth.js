import { consoleRequest } from './api.js';

const logout = document.querySelector('#session-logout');
try {
  const session = await consoleRequest('/console-api/v1/auth/session');
  document.querySelector('#session-user').textContent = session.displayName || 'Works 사용자';
  document.querySelector('#session-organization').textContent = session.organizationName || '선택 조직';
  document.querySelector('#session-role').textContent = 'Console';
  document.querySelector('.environment').textContent = 'HJ-Works';
  logout.hidden = false;
  const permissions = new Set(session.permissions);
  const required = {
    create: 'apps:write',
    'issue-credential': 'credentials:rotate',
    'rotate-credential': 'credentials:rotate',
    'revoke-credential': 'credentials:revoke',
    'index-knowledge': 'knowledge:write',
    'reindex-knowledge': 'knowledge:write',
    'retry-knowledge-job': 'knowledge:write',
    'archive-knowledge': 'knowledge:write',
    'delete-knowledge-object': 'knowledge:write',
    'retry-knowledge-cleanup': 'knowledge:write',
  };
  const applyPermissions = () => {
    for (const element of document.querySelectorAll('[data-action]')) {
      const permission = required[element.dataset.action];
      if (permission) element.hidden = !permissions.has(permission);
    }
    for (const selector of ['#knowledge-upload-form', '#knowledge-policy-form']) {
      const form = document.querySelector(selector);
      if (form) form.hidden = !permissions.has('knowledge:write');
    }
    const appForm = document.querySelector('#detail-form');
    if (appForm) for (const input of appForm.querySelectorAll('input, textarea, button')) input.disabled = !permissions.has('apps:write');
  };
  applyPermissions();
  new MutationObserver(applyPermissions).observe(document.querySelector('#app-view'), { childList: true, subtree: true });
} catch {
  // API views show the login or unavailable state; never display a fictitious identity.
  document.querySelector('#session-organization').textContent = '미선택';
}

logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await consoleRequest('/console-api/v1/auth/logout', { method: 'POST' });
    window.location.replace('/console');
  } catch {
    logout.disabled = false;
    document.querySelector('#session-role').textContent = '로그아웃 실패 · 다시 시도';
  }
});
