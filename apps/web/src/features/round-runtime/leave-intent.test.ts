import { assert, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';
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
      'a debater in a new Round, the same debater speaking, and after the last speech while the Round awaits its ballot',
    should:
      'forfeit while the Round is live, then leave freed: the debate is over and nothing is forfeited (ISSUE-590)',
    actual: [
      leaveIntent(
        { ...view, status: 'opening' },
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
      forfeit({ ...view, status: 'opening' }),
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

test('a seated debater whose forfeit is unavailable is held, never free to leave (ISSUE-879)', () => {
  const overran = ran(1);
  const pastPersistedPhase = Date.parse(at(startOf(1) + 1000));
  assert({
    given: 'a debater whose speech ran out before the next phase persisted',
    should: 'hold them, because no command could confirm a departure',
    actual: leaveIntent(overran, aff.actorId, pastPersistedPhase),
    expected: { kind: 'held' },
  });
});

test('Leave in the opening follows the engine’s forfeit rule', () => {
  const opening = { ...view, status: 'opening' as const, startedAt: null };
  const held = {
    ...opening,
    checkpoint: {
      ...emptyRuntimeCheckpoint,
      incident: {
        phase: 'paused' as const,
        since: at(0),
        cause: 'vendor_unreachable' as const,
        resume_point: null,
      },
    },
  };
  assert({
    given: 'a debater in an opening Round that a platform incident holds',
    should:
      'hold them, as the engine refuses that forfeit, where an unheld opening forfeits',
    actual: [opening, held].map(
      (round) => leaveIntent(round, aff.actorId, Date.parse(at(0))).kind,
    ),
    expected: ['forfeit', 'held'],
  });
  assert({
    given: 'an opening Round whose checkpoint this view could not read',
    should: 'hold them, as an active Round does: nothing can be offered',
    actual: leaveIntent(
      { ...opening, checkpoint: null },
      aff.actorId,
      Date.parse(at(0)),
    ).kind,
    expected: 'held',
  });
});
