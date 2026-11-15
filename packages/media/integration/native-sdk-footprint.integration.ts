import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();
requireTestServices(process.env);

test('DEC419 acquires pinned SDK archive footprints once on normal Linux CI', async () => {
  // This is a finite CI acquisition, never an implicit developer-machine download.
  if (process.env.GITHUB_ACTIONS !== 'true') {
    process.stdout.write(
      'DEC419 archive acquisition is reserved for the authorized Linux CI pass\n',
    );
    return;
  }
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/native-sdk-footprint-process.test-support.ts`,
    ],
    {
      stdout: 'inherit',
      stderr: 'pipe',
      timeout: 900000,
      maxBuffer: 1024 * 1024,
    },
  );
  // Raw transport/loader errors are counted, never forwarded to the CI report.
  const stderrBytes = (await new Response(child.stderr).arrayBuffer())
    .byteLength;
  const exitCode = await child.exited;
  process.stdout.write(
    JSON.stringify({
      event: 'native.sdkFootprint.process',
      exitCode,
      signalCode: child.signalCode,
      stderrBytes,
    }) + '\n',
  );
  assert({
    given:
      'one native Linux CI acquisition with fixed vendor pins and 900s/2GiB bounds',
    should:
      'finish without compilation, archive extraction or acquisition retry',
    actual: { exitCode, signalCode: child.signalCode, stderrBytes },
    expected: { exitCode: 0, signalCode: null, stderrBytes: 0 },
  });
}, 910000);
