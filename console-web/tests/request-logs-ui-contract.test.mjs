import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [appSource, html] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);

test('요청 로그 메뉴, 필터, 목록과 상세 화면이 연결된다', () => {
  assert.match(html, /href="\/console\/request-logs" data-link/);
  assert.match(appSource, /requestLogsApi\.list/);
  assert.match(appSource, /requestLogsApi\.get/);
  assert.match(appSource, /id="request-log-filters"/);
  assert.match(appSource, /data-log-id/);
  assert.match(appSource, /실행 Metadata/);
  assert.match(appSource, /CSV 내보내기/);
  assert.match(appSource, /errorCode/);
});

test('Console 화면은 질문과 응답 원문을 노출하지 않는다', () => {
  assert.match(appSource, /질문·응답 원문 제외/);
  assert.match(appSource, /metadata only/);
  assert.doesNotMatch(appSource, /log\.question/);
  assert.doesNotMatch(appSource, /log\.response/);
});
