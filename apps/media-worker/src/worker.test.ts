import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createWorkerLogger } from './worker';
setupRitewayBun();

test('worker log lines name the release the image was built from', () => {
  const lines: string[] = [];
  createWorkerLogger(
    {
      APP_VERSION: 'bc6532f',
      GIT_COMMIT: 'bc6532f818085d822b99fac238b7284e21ad7cee',
    },
    { write: (text) => lines.push(text) },
  ).log('media.capture.failed', { status: 8 }, 'Capture process failed');
  const entry = JSON.parse(lines[0] ?? '{}');
  assert({
    given: 'the validated deployment identity (ISSUE-554)',
    should: 'stamp each worker log line with its version and commit',
    actual: [entry.service, entry.appVersion, entry.gitCommit],
    expected: [
      'media-worker',
      'bc6532f',
      'bc6532f818085d822b99fac238b7284e21ad7cee',
    ],
  });
});
