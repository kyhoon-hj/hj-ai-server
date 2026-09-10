import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.soak.json'], { stdio: 'inherit' });
const identity = JSON.parse(execFileSync(process.execPath, ['scripts/stamp-build.mjs', '--print'], { encoding: 'utf8' }));
const hash = createHash('sha256');
for (const file of ['test/multiprocess-soak.ts', 'test/fixtures/soak-worker-process.ts', 'tsconfig.soak.json', 'scripts/build-soak.mjs']) {
  hash.update(file).update('\0').update(await readFile(file)).update('\0');
}
identity.harnessSha256 = hash.digest('hex');
await writeFile('work/soak-build/build-info.json', JSON.stringify(identity, null, 2) + '\n');
console.log('Compiled soak runtime: work/soak-build (plain Node.js, no ts-node).');
