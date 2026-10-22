import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('지식 목록·선택 파일 정책을 표시하고 파일명은 HTML로 실행하지 않는다', () => {
  const sandbox = vm.createContext({ state: { knowledgeSelectedFileId: 'file-1', knowledgeJobs: [], knowledgeJobsError: null } });
  vm.runInContext(
    [
      section('function escapeHtml(', 'function showToast('),
      section('function detailTabs(', 'function filteredApps('),
      section('function knowledgeJobsMarkup(', 'async function renderKnowledge('),
    ].join('\n'),
    sandbox,
  );
  const html = vm.runInContext(`knowledgeMarkup({ id: 'app-1', appname: '지원', maxStorageMb: 30 }, [{ id: 'file-1', originalName: '<script>alert(1)</script>.txt', mimetype: 'text/plain', size: 12, status: 'uploaded', accessLevel: 'PUBLIC', businessStatus: 'PUBLISHED', productCodes: ['P1'], chunkCount: 0, createdAt: '2026-10-02T00:00:00Z' }])`, sandbox);
  assert.match(html, /지식 관리/);
  assert.match(html, /knowledge-upload-form/);
  assert.match(html, /knowledge-policy-form/);
  assert.match(html, /색인 작업/);
  assert.match(html, /value="PUBLISHED" selected/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);

  sandbox.state.knowledgeJobs = [{ id: 'job-1', operation: 'index', status: 'failed', attempt: 1, maxAttempts: 3, retryable: true, errorCode: 'UPSTREAM_TIMEOUT', errorMessage: '<secret>', requestedAt: '2026-10-02T01:00:00Z' }];
  const failedHtml = vm.runInContext(`knowledgeMarkup({ id: 'app-1', appname: '지원', maxStorageMb: 30 }, [{ id: 'file-1', originalName: 'policy.txt', mimetype: 'text/plain', size: 12, status: 'failed', chunkCount: 0 }])`, sandbox);
  assert.match(failedHtml, /시도 1\/3/);
  assert.match(failedHtml, /UPSTREAM_TIMEOUT/);
  assert.match(failedHtml, /data-action="retry-knowledge-job"/);
  assert.match(failedHtml, /&lt;secret&gt;/);
  assert.doesNotMatch(failedHtml, /<secret>/);

  sandbox.state.knowledgeIncludeArchived = true;
  const archivedHtml = vm.runInContext(`knowledgeMarkup({ id: 'app-1', appname: '지원', maxStorageMb: 30 }, [{ id: 'file-1', originalName: 'policy.txt', mimetype: 'text/plain', size: 12, status: 'archived', businessStatus: 'RETIRED', objectCleanupStatus: 'failed', deleteObjectRequested: true, deletedObject: false, chunkCount: 0 }])`, sandbox);
  assert.match(archivedHtml, /보관 파일 숨기기/);
  assert.match(archivedHtml, /원본 삭제 재시도/);
  assert.doesNotMatch(archivedHtml, /knowledge-policy-form/);
});
