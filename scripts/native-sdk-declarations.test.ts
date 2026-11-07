import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

test('native SDK public import and require declarations expose bounded stats on Track and aliases', () => {
  const result = Bun.spawnSync(
    [
      'bun',
      'x',
      '--no-install',
      'tsgo',
      '--noEmit',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--strict',
      '--skipLibCheck',
      '--types',
      'bun',
      'packages/media/integration/native-track-stats-public.test-support.cts',
      'packages/media/integration/native-track-stats-public.test-support.mts',
    ],
    { stdout: 'pipe', stderr: 'pipe', timeout: 30000 },
  );
  assert({
    given:
      'the pinned installed SDK resolved through its public root under import and require conditions',
    should:
      'typecheck Track, RemoteTrack and inherited LocalAudioTrack getStats without private paths or shadow interfaces',
    actual: {
      exit: result.exitCode,
      diagnostics: result.stdout.toString() + result.stderr.toString(),
    },
    expected: { exit: 0, diagnostics: '' },
  });
});
