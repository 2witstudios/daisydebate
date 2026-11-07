import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureObservationOutput } from './capture-observation-output.test-support';
setupRitewayBun();

test('ordinary integration owns private ephemeral output without requiring a proof-only environment variable', async () => {
  const output = await captureObservationOutput();
  const mode = (await stat(output.directory)).mode & 0o777;
  await output.close();
  assert({
    given: 'an ordinary runner with no explicit evidence directory',
    should:
      'allocate a private capture root and remove only that owned ephemeral root at teardown',
    actual: [
      output.directory.startsWith('/tmp/billing-capture-'),
      mode,
      await stat(output.directory).then(
        () => true,
        () => false,
      ),
    ],
    expected: [true, 0o700, false],
  });
});
test('explicit proof output remains retained and invalid paths are refused', async () => {
  const directory = await mkdtemp('/tmp/billing-capture-output-unit-');
  try {
    const output = await captureObservationOutput(directory);
    await writeFile(directory + '/proof.txt', 'retained evidence');
    await output.close();
    const refused = await captureObservationOutput('/tmp/foreign-output').then(
      () => false,
      () => true,
    );
    assert({
      given:
        'an explicitly supplied owned proof directory or an unrelated path',
      should: 'preserve proof bytes and refuse unrelated output ownership',
      actual: [await Bun.file(directory + '/proof.txt').text(), refused],
      expected: ['retained evidence', true],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
