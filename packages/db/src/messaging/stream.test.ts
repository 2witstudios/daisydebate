import { readFileSync } from 'node:fs';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { allocateStream } from './stream';
setupRitewayBun();
test('allocateStream is a pure whole-plan allocation from the locked high-water mark', () => {
  const current = { messageSequence: 2, changeVersion: 4 };
  assert({
    given: 'one message and one reaction-like change after it',
    should: 'allocate contiguously without changing its input',
    actual: [allocateStream(current, { messages: 1, changes: 2 }), current],
    expected: [
      {
        messageSequence: 3,
        changeVersion: 6,
        sequences: [3],
        versions: [5, 6],
      },
      { messageSequence: 2, changeVersion: 4 },
    ],
  });
});

/** Production source outside the stream module that names a stream counter write. */
function streamWriters(root: string) {
  const writes = [
    /(?:update|insert\s+into|delete\s+from)\s+"?messaging_channel_streams\b/iu,
    /\.(?:update|insert|delete)\(\s*messagingChannelStreams\b/u,
  ];
  const writers: string[] = [];
  const files = [
    ...new Bun.Glob('apps/*/src/**/*.{ts,tsx}').scanSync(root),
    ...new Bun.Glob('packages/*/src/**/*.{ts,tsx}').scanSync(root),
  ];
  if (!files.includes('packages/db/src/messaging/stream.ts'))
    throw new Error('Writer scan did not reach the stream module');
  for (const file of files) {
    if (
      /\.test(?:-support)?\.tsx?$|\/test-fixture\.ts$/u.test(file) ||
      file === 'packages/db/src/messaging/stream.ts'
    )
      continue;
    const source = readFileSync(`${root}/${file}`, 'utf8');
    if (writes.some((pattern) => pattern.test(source))) writers.push(file);
  }
  return writers.sort();
}

test('only stream.ts writes the channel stream counters (MSG-2.2-arch1)', () => {
  const root = new URL('../../../../', import.meta.url).pathname;
  assert({
    given: 'every production module in the repository',
    should: 'leave appendStream and openStream the only stream writers',
    actual: streamWriters(root),
    expected: [],
  });
});
