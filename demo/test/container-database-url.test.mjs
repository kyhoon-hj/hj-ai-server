import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveChildExitCode,
  resolveContainerDatabaseUrl,
} from '../../config/start-container.mjs';

test('Docker 실행에서 localhost DB 호스트만 게이트웨이 주소로 변경한다', () => {
  const result = new URL(
    resolveContainerDatabaseUrl(
      'postgresql://user:secret@localhost:5432/hj-ai',
    ),
  );
  assert.equal(result.hostname, 'host.docker.internal');
  assert.equal(result.port, '5432');
  assert.equal(result.pathname, '/hj-ai');
});

test('원격 DB 주소는 Docker 실행에서도 변경하지 않는다', () => {
  const value = 'postgresql://user:secret@db.example.com:5432/hj-ai';
  assert.equal(resolveContainerDatabaseUrl(value), value);
});

test('Docker DB 호스트를 명시적으로 재정의할 수 있다', () => {
  const result = new URL(
    resolveContainerDatabaseUrl(
      'postgresql://user:secret@127.0.0.1:5432/hj-ai',
      'database.internal',
    ),
  );
  assert.equal(result.hostname, 'database.internal');
});

test('전달한 종료 신호로 서버가 종료되면 정상 종료 코드로 변환한다', () => {
  assert.equal(resolveChildExitCode(null, 'SIGTERM', 'SIGTERM'), 0);
  assert.equal(resolveChildExitCode(null, 'SIGKILL', 'SIGTERM'), 1);
  assert.equal(resolveChildExitCode(2, null, undefined), 2);
});
