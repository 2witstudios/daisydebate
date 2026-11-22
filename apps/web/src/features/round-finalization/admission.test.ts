import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requirePanelRound } from './admission';
setupRitewayBun();
type Round = NonNullable<Parameters<typeof requirePanelRound>[0]> & {
  readonly participants: readonly { readonly role: string }[];
};
const round = (overrides: Partial<Round> = {}): Round => ({
  segments: [{ endedAt: '2026-10-22T12:00:00.000Z' }],
  participants: [{ role: 'affirmative' }, { role: 'negative' }],
  ...overrides,
});

test('only a fully played Round is eligible, on any ladder, judged or not', async () => {
  for (const [label, candidate] of [
    ['a missing Round', null],
    ['an unfinished segment', round({ segments: [{ endedAt: null }] })],
  ] as const)
    await assertRejects({
      given: `${label}`,
      should: 'refuse deadline completion as ineligible',
      actual: () => requirePanelRound(candidate as Round),
      code: 'CONFLICT',
    });
  assert({
    given: 'a played casual Round without judges, and one with a judge seat',
    should: 'admit both',
    actual: [
      requirePanelRound(round()),
      requirePanelRound(
        round({ participants: [{ role: 'affirmative' }, { role: 'judge' }] }),
      ),
    ],
    expected: [undefined, undefined],
  });
});
