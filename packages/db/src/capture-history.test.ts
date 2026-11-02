import { assert, setupRitewayBun, test } from 'riteway/bun';
import { coverageAuthority } from './capture-history';
import type { CaptureRule } from '@daisy/protocol';
import type { CaptureTx } from './media-capture-context';

setupRitewayBun();
const stream = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
  epoch: 1,
  segmentId: 'g'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
};
const grants = [{ start: 1000, end: 6000 }];
/** Echoes what the adapter read: the decision itself is the engine's, tested there. */
const tolerance = {
  coverage: (kind: string, authorityGrants: unknown, botWindows: unknown) => ({
    kind,
    authorityGrants,
    botWindows,
  }),
} as unknown as CaptureRule;
/** Answers each select with the next canned rows, in query order. */
const reading = (...answers: readonly unknown[][]) => {
  const queue = [...answers];
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: async () => queue.shift() ?? [],
  };
  return { select: () => query } as unknown as CaptureTx;
};

test('a human seat\u2019s stream is read for the rule as human', async () => {
  assert({
    given: 'a human seat and one without a readable actor',
    should: 'ask the rule for a human stream, with its grants',
    actual: [
      await coverageAuthority(
        reading([{ kind: 'human' }]),
        stream,
        grants,
        tolerance,
      ),
      await coverageAuthority(reading([]), stream, grants, tolerance),
    ],
    expected: [
      { kind: 'human', authorityGrants: grants, botWindows: [] },
      { kind: 'human', authorityGrants: grants, botWindows: [] },
    ],
  });
});

test('a bot seat\u2019s stream is read for the rule with its credited windows', async () => {
  assert({
    given: 'a bot seat with two credited runs, and one with none',
    should:
      'ask the rule for a bot stream, with exactly those windows as instants',
    actual: [
      await coverageAuthority(
        reading(
          [{ kind: 'bot' }],
          [
            { start: new Date(1880), end: new Date(4790) },
            { start: new Date(5000), end: new Date(5500) },
          ],
        ),
        stream,
        grants,
        tolerance,
      ),
      await coverageAuthority(
        reading([{ kind: 'bot' }], []),
        stream,
        grants,
        tolerance,
      ),
    ],
    expected: [
      {
        kind: 'bot',
        authorityGrants: grants,
        botWindows: [
          { start: 1880, end: 4790 },
          { start: 5000, end: 5500 },
        ],
      },
      { kind: 'bot', authorityGrants: grants, botWindows: [] },
    ],
  });
});
