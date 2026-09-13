import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireStandardPort,
  STANDARD_PORTS,
} from '../../config/standard-ports.mjs';
import { SERVICE_DEMO_PORT } from '../../service-demo/port.config.mjs';

test('로컬과 운영의 네 애플리케이션 포트를 고정한다', () => {
  assert.deepEqual(STANDARD_PORTS, {
    aiServer: 11000,
    validationDemo: 11001,
    serviceDemo: 11002,
    consoleWeb: 11003,
  });
  assert.equal(requireStandardPort('validationDemo'), 11001);
  assert.equal(requireStandardPort('validationDemo', '11001'), 11001);
  assert.equal(SERVICE_DEMO_PORT, 11002);
  assert.equal(requireStandardPort('consoleWeb'), 11003);
});

test('표준과 다른 데모 포트를 거절한다', () => {
  assert.throws(
    () => requireStandardPort('validationDemo', 3200),
    /11001로 고정/,
  );
  assert.throws(
    () => requireStandardPort('serviceDemo', 12002),
    /11002로 고정/,
  );
});
