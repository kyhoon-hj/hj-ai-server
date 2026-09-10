import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Hash only runtime source/schema inputs, including builds without Git (Docker).
const paths = [];
async function collect(directory, extensions) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path, extensions);
    else if (extensions.test(entry.name)) paths.push(path);
  }
}
await collect('src', /\.(ts|json)$/);
await collect('prisma', /\.(prisma|sql|toml)$/);
paths.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json', 'scripts/stamp-build.mjs');
paths.sort();
let revision = null;
let workingTreeDirty = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
} catch { /* A source fingerprint remains available in builds without Git. */ }
const hash = createHash('sha256');
for (const path of paths) {
  hash.update(path).update('\0').update(await readFile(path)).update('\0');
}
const identity = JSON.stringify({
  revision,
  workingTreeDirty,
  sourceSha256: hash.digest('hex'),
}, null, 2) + '\n';
if (process.argv.includes('--print')) process.stdout.write(identity);
else await writeFile('dist/build-info.json', identity);
