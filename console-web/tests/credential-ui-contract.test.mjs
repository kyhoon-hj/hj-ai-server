import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(
  new URL('../public/app.js', import.meta.url),
  'utf8',
);
const documentSource = await readFile(
  new URL('../public/index.html', import.meta.url),
  'utf8',
);

test('발급 Key를 브라우저 영구 저장소에 기록하지 않는다', () => {
  assert.doesNotMatch(appSource, /localStorage|sessionStorage|indexedDB/);
  assert.match(appSource, /issuedKey\.value = value/);
  assert.match(appSource, /issuedKey\.value = ''/);
});

test('Key 확인 전에는 일회성 표시창을 닫을 수 없다', () => {
  assert.match(documentSource, /id="close-key-reveal"[^>]*disabled/);
  assert.match(appSource, /keyRevealDialog\.addEventListener\('cancel'/);
  assert.match(
    appSource,
    /closeKeyReveal\.disabled = !keySavedConfirmation\.checked/,
  );
});

test('폐기는 별도 확인 dialog를 거친다', () => {
  assert.match(documentSource, /id="revoke-dialog"/);
  assert.match(appSource, /openRevokeDialog/);
  assert.match(appSource, /credentialsApi\.revoke/);
});
