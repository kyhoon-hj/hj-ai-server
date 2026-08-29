import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeStagedFile, sha256StagedFile } from './staged-upload';

describe('staged upload', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('hashes a staged file and removes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hj-ai-stage-test-'));
    tempDirectories.push(directory);
    const path = join(directory, 'fixture.upload');
    const body = Buffer.from('streamed checksum');
    await writeFile(path, body);
    const file = { path } as Express.Multer.File;

    await expect(sha256StagedFile(file)).resolves.toBe(
      createHash('sha256').update(body).digest('hex'),
    );
    await removeStagedFile(file);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(removeStagedFile(file)).resolves.toBeUndefined();
  });
});
