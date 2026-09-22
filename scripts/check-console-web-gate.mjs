import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run test:console-web-gate.');
const workspace = resolve(root, 'work');
await mkdir(workspace, { recursive: true });
const fixture = await mkdtemp(join(workspace, 'console-web-gate-'));
const failureMarker = 'CONSOLE_WEB_GATE_EXPECTED_FAILURE';
const laterMarker = 'CONSOLE_WEB_GATE_LATER_STEP';

try {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  // Preserve the real verify command and Console Web tests. Only unrelated
  // expensive checks are stubbed in this disposable failure-injection fixture.
  await writeFile(join(fixture, 'package.json'), JSON.stringify({
    private: true,
    scripts: {
      verify: manifest.scripts.verify,
      'test:console-web': manifest.scripts['test:console-web'],
      build: 'node -e "process.exit(0)"',
      typecheck: 'node -e "process.exit(0)"',
      'lint:check': 'node -e "process.exit(0)"',
      'test:ci': 'node -e "process.exit(0)"',
      'test:demo': `node -e "console.log('${laterMarker}')"`,
    },
  }));
  await cp(join(root, 'console-web'), join(fixture, 'console-web'), {
    recursive: true,
    filter: (source) => !source.split(sep).includes('node_modules'),
  });
  await writeFile(join(fixture, 'console-web/tests/gate-failure.test.mjs'),
    `import test from 'node:test';\ntest('${failureMarker}', () => { throw new Error('${failureMarker}'); });\n`);
  const result = spawnSync(process.execPath, [npmCli, 'run', 'verify'], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert.notEqual(result.status, null, output);
  assert.notEqual(result.status, 0, 'verify incorrectly accepted a failing Console Web test');
  assert.ok(output.includes(failureMarker), `Injected Web test was not reached:\n${output}`);
  // npm prints the complete verify command; require the later command's own
  // output line to detect actual execution, not its mention in that command.
  assert.ok(!output.split(/\r?\n/).includes(laterMarker), 'verify continued after Console Web failure');
  console.log(`PASS: Console Web failure reached verify (exit ${result.status}); later checks stopped.`);
} finally {
  const target = resolve(fixture);
  assert.ok(target.startsWith(`${workspace}${sep}console-web-gate-`));
  await rm(target, { recursive: true, force: true });
}
