import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(demoRoot, 'fixtures');

test('다중 형식 parser fixture manifest와 바이너리 파일이 일치한다', async () => {
  const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8'));

  assert.equal(manifest.version, '2.0.0');
  assert.equal(manifest.files.length, 6);
  assert.equal(manifest.parserFixtures.length, 3);

  const expectedTypes = new Set(['pdf', 'docx', 'xlsx']);
  const markers = new Set();

  for (const fixture of manifest.parserFixtures) {
    assert.equal(manifest.files.includes(fixture.name), true);
    assert.equal(expectedTypes.delete(fixture.sourceType), true);
    assert.equal(markers.has(fixture.searchMarker), false);
    assert.equal(fixture.minimumChunkCount > 0, true);

    markers.add(fixture.searchMarker);
    const fixtureStat = await stat(join(fixtureRoot, fixture.name));
    assert.equal(fixtureStat.isFile(), true);
    assert.equal(fixtureStat.size > 0, true);
  }

  assert.equal(expectedTypes.size, 0);
});
