import { assert, setupRitewayBun, test } from 'riteway/bun';
import { at, ran } from '../../ui/debate-room/live-round.test-support';
import { nextMediaRefreshAt } from './refresh-deadline';
setupRitewayBun();
test('media refresh follows actual countdown and early closure anchors', () => {
  const starting = ran(0),
    gap = ran(1, true);
  assert({
    given: 'an actual accepted start before any segment exists',
    should: 'request a server read at its countdown boundary',
    actual: nextMediaRefreshAt(starting),
    expected: Date.parse(starting.startedAt!) + starting.rules.countdownMs,
  });
  assert({
    given: 'an actual early segment close before the next opens',
    should: 'use that committed close as its next countdown anchor',
    actual: nextMediaRefreshAt(gap),
    expected: Date.parse(gap.segments[0]!.endedAt!) + gap.rules.countdownMs,
  });
});
test('prep refresh overrides the ordinary gap and judging uses actual final close', () => {
  const gap = ran(1, true),
    prep = {
      ...gap,
      checkpoint: {
        ...gap.checkpoint!,
        active_prep: { side: 'negative' as const, started_at: at(20000) },
      },
    };
  assert({
    given: 'active prep with its remaining budget',
    should: 'refresh at prep expiry without scheduling an ordinary gap opening',
    actual: nextMediaRefreshAt(prep),
    expected: Date.parse(at(20000)) + prep.rules.inRoundPrep!.budgetMsPerSide,
  });
  const final = ran(gap.rules.segments.length, true);
  assert({
    given: 'all actual segments closed while awaiting a ballot',
    should: 'refresh at the judging-window boundary',
    actual: nextMediaRefreshAt(final),
    expected: Date.parse(final.segments.at(-1)!.endedAt!) + 1800000,
  });
});
