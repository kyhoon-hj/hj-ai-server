import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_SERVER_STANDARD_PORT,
  CONSOLE_WEB_STANDARD_PORT,
  requireConsoleWebPort,
} from '../port.config.mjs';

test('Console Web과 AI Server 표준 포트를 고정한다', () => {
  assert.equal(CONSOLE_WEB_STANDARD_PORT, 11003);
  assert.equal(AI_SERVER_STANDARD_PORT, 11000);
  assert.equal(requireConsoleWebPort(), 11003);
  assert.equal(requireConsoleWebPort('11003'), 11003);
  assert.throws(() => requireConsoleWebPort('3000'), /11003/);
});
