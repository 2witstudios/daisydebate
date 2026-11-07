import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { expect, test } from 'bun:test';
import { makeCaptureRoot } from '../integration/billing-capture-output.test-support';

test('ordinary integration runners allocate unique private capture roots without an environment override', async () => {
  const first = await makeCaptureRoot(undefined);
  const second = await makeCaptureRoot(undefined);
  try {
    expect([
      first !== second,
      first.startsWith('/tmp/billing-capture-'),
      (await stat(first)).mode & 0o777,
      (await stat(second)).mode & 0o777,
    ]).toEqual([true, true, 0o700, 0o700]);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test('explicit private proof roots preserve existing artifacts', async () => {
  const parent = await mkdtemp('/tmp/billing-capture-root-test-');
  const directory = parent + '/proof';
  try {
    await mkdir(directory, { mode: 0o700 });
    await writeFile(directory + '/retained', 'TEST receipt', { mode: 0o600 });
    expect([
      await makeCaptureRoot(directory),
      await Bun.file(directory + '/retained').text(),
      (await stat(directory)).mode & 0o777,
    ]).toEqual([directory, 'TEST receipt', 0o700]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('explicit foreign or traversal paths still refuse instead of falling back', async () => {
  for (const path of [
    '/tmp/foreign-capture',
    '/tmp/billing-capture-../escape',
    '',
  ])
    await expect(makeCaptureRoot(path)).rejects.toThrow(
      'Named private capture output required',
    );
});
