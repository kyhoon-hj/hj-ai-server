import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [appSource, html] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);

test('사용량 메뉴와 세 집계 API가 실제 dashboard에 연결된다', () => {
  assert.match(html, /href="\/console\/usage" data-link/);
  assert.match(appSource, /usageApi\.summary/);
  assert.match(appSource, /usageApi\.timeseries/);
  assert.match(appSource, /usageApi\.breakdown/);
  assert.match(appSource, /id="usage-range"/);
  assert.match(appSource, /일별 요청/);
  assert.match(appSource, /앱별 사용량/);
  assert.match(appSource, /summary\.embeddings\.operations/);
  assert.match(appSource, /app\.embeddings\.operations/);
});

test('미측정 값을 명시적인 0과 구분해 표시한다', () => {
  assert.match(appSource, /measurement\?\.value === null/);
  assert.match(appSource, /미측정/);
  assert.match(appSource, /measuredRequests/);
});

test('결과가 측정된 요청만으로 성공률을 표시한다', () => {
  assert.match(appSource, /summary\.outcome\.successRate/);
  assert.match(appSource, /summary\.outcome\.measuredRequests/);
});
