import { assert, setupRitewayBun, test } from 'riteway/bun';
import { coverageAuthority } from './capture-history';
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
const tolerance = { joinMs: 4000, relayMs: 1000 };
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

test('a human seat must cover its grants, joined within the join tolerance (DEC-218)', async () => {
  assert({
    given: 'a human seat and one without a readable actor',
    should:
      'require its grants, opening by join tolerance and closing by relay',
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
      { authority: grants, tolerance: { openMs: 4000, closeMs: 1000 } },
      { authority: grants, tolerance: { openMs: 4000, closeMs: 1000 } },
    ],
  });
});

test('a bot seat must cover only its credited windows, joined within relay latency (DEC-218, DEC-219)', async () => {
  assert({
    given: 'a bot seat with two credited runs, and one with none',
    should:
      'require exactly those windows with relay edges, never the floor grants',
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
        authority: [
          { start: 1880, end: 4790 },
          { start: 5000, end: 5500 },
        ],
        tolerance: { openMs: 1000, closeMs: 1000 },
      },
      { authority: [], tolerance: { openMs: 1000, closeMs: 1000 } },
    ],
  });
});
