import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

// Captured once at process startup, never inferred from a mutable checkout per request.
function readBuildIdentity() {
  try {
    const sourceMode = __filename.endsWith('.ts');
    const data = JSON.parse(
      sourceMode
        ? execFileSync(
            process.execPath,
            [resolve(__dirname, '../../scripts/stamp-build.mjs'), '--print'],
            {
              cwd: resolve(__dirname, '../..'),
              encoding: 'utf8',
              timeout: 5000,
              stdio: ['ignore', 'pipe', 'ignore'],
            },
          )
        : readFileSync(resolve(__dirname, '../../build-info.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (
      (data.revision === null ||
        (typeof data.revision === 'string' &&
          /^[a-f0-9]{40,64}$/.test(data.revision))) &&
      typeof data.sourceSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(data.sourceSha256) &&
      (data.workingTreeDirty === null ||
        typeof data.workingTreeDirty === 'boolean')
    ) {
      return {
        revision: data.revision,
        sourceSha256: data.sourceSha256,
        workingTreeDirty: data.workingTreeDirty,
        mode: sourceMode ? 'source' : 'build',
      };
    }
  } catch {
    // Unstamped artifacts have explicitly unknown provenance.
  }
  return {
    revision: null,
    sourceSha256: null,
    workingTreeDirty: null,
    mode: 'unknown',
  };
}

const processBuildIdentity = readBuildIdentity();
export function loadBuildIdentity() {
  return processBuildIdentity;
}
