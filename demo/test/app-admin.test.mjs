import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAppId,
  issuedApp,
  normalizeCreateAppInput,
  normalizeRotateAppInput,
  normalizeStatusInput,
  publicApp,
} from '../app-admin.mjs';

test('normalizes an explicitly confirmed app issuance request', () => {
  assert.deepEqual(normalizeCreateAppInput({
    confirmIssue: true,
    appname: ' Store Assistant ',
    appcode: 'STORE-ASSISTANT',
    allowedAccessLevels: ['PUBLIC', 'PUBLIC'],
    appkeyTtlDays: '90',
  }), {
    appname: 'Store Assistant',
    appcode: 'store-assistant',
    allowedAccessLevels: ['PUBLIC'],
    status: 'active',
    appkeyTtlDays: 90,
    metadata: { purpose: 'appkey-admin-console' },
  });
});

test('rejects issuance, rotation, and status changes without explicit confirmation', () => {
  assert.throws(() => normalizeCreateAppInput({ appname: 'A', appcode: 'aa' }), /발급 확인/);
  assert.throws(() => normalizeRotateAppInput({}), /회전 확인/);
  assert.throws(() => normalizeStatusInput({ status: 'inactive' }), /상태 변경 확인/);
});

test('validates app identity and lifecycle limits', () => {
  assert.equal(assertAppId('3df15c39-8f9d-4c18-8573-01f4f06e18dd'), '3df15c39-8f9d-4c18-8573-01f4f06e18dd');
  assert.throws(() => assertAppId('../app'), /유효한 앱 ID/);
  assert.throws(() => normalizeRotateAppInput({ confirmRotate: true, gracePeriodSeconds: 86401 }), /0~86400/);
});

test('never exposes stored key material in list output and exposes a newly issued key once', () => {
  const source = { id: 'id', appcode: 'store', appkey: 'secret', appkeyHash: 'hash', previousAppkeyHash: 'old-hash' };
  assert.deepEqual(publicApp(source), { id: 'id', appcode: 'store' });
  assert.deepEqual(issuedApp(source), {
    app: { id: 'id', appcode: 'store' },
    issued: { appkey: 'secret', expiresAt: null, rotatedAt: null, previousAppkeyValidUntil: null },
  });
});
