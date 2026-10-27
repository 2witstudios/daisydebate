import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leaveIntent } from './leave-intent';
import {
  view,
  aff,
  judge,
  ran,
  at,
  startOf,
  rules,
} from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();

test('Leave forfeits only a live debater’s own Round (ADR 0070)', () => {
  const speaking = ran(1);
  const forfeit = (round: typeof view) => ({
    kind: 'forfeit',
    participantId: aff.id,
    expectedVersion: round.version,
  });
  assert({
    given:
      'a debater in a scheduled Round, the same debater speaking, and after the last speech while the Round awaits its ballot',
    should:
      'forfeit while the Round is live, then leave freed: the debate is over and nothing is forfeited (ISSUE-590)',
    actual: [
      leaveIntent(
        { ...view, status: 'scheduled' },
        aff.actorId,
        Date.parse(at(0)),
      ),
      leaveIntent(speaking, aff.actorId, Date.parse(at(startOf(0) + 1000))),
      leaveIntent(
        ran(rules.length, true),
        aff.actorId,
        Date.parse(at(startOf(rules.length) + 1000)),
      ),
    ],
    expected: [
      forfeit({ ...view, status: 'scheduled' }),
      forfeit(speaking),
      { kind: 'freed' },
    ],
  });
  assert({
    given: 'the judge and a viewer with no seat in a speaking Round',
    should: 'only navigate: neither can forfeit',
    actual: [judge.actorId, 'x'.repeat(24)].map((actorId) =>
      leaveIntent(speaking, actorId, Date.parse(at(startOf(0) + 1000))),
    ),
    expected: [{ kind: 'navigate' }, { kind: 'navigate' }],
  });
});

test('only a debater is told they are freed while the ballot is pending (ISSUE-590)', () => {
  const judging = ran(rules.length, true);
  const after = Date.parse(at(startOf(rules.length) + 1000));
  assert({
    given: 'the judge and an unseated viewer of a Round awaiting its ballot',
    should: 'only navigate: the judge still ballots, and a viewer held nothing',
    actual: [judge.actorId, 'x'.repeat(24)].map((actorId) =>
      leaveIntent(judging, actorId, after),
    ),
    expected: [{ kind: 'navigate' }, { kind: 'navigate' }],
  });
});
