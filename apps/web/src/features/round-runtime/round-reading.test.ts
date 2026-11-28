import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isLiveRound,
  isSeat,
  judgeKindOf,
  sameTeam,
} from './round-reading';
import { observedRoundOf } from './observed-round';
import { liveRoundOf } from '../../ui/debate-room/live-round';
import {
  neg,
  view,
  ran,
  at,
  startOf,
} from '../../ui/debate-room/live-round.test-support';

setupRitewayBun();

test('one reading of sides, seats, liveness and judge (ISSUE-672)', () => {
  assert({
    given: 'the shared round reading',
    should:
      'tell competitor seats from the judge, treat scheduled and active as live and read the judge kind',
    actual: [
      view.participants.map(isSeat),
      (['opening', 'active', 'completed', 'abandoned'] as const).map((status) =>
        isLiveRound({ ...view, status }),
      ),
      judgeKindOf(view),
      judgeKindOf({
        ...view,
        participants: view.participants.filter((p) => p.seat.kind !== 'judge'),
      }),
    ],
    expected: [
      view.participants.map((p) => p.seat.kind !== 'judge'),
      [true, true, false, false],
      'human',
      null,
    ],
  });
});

test('a teammate stands with you; an unsided speaker stands alone (TAB-6.17)', () => {
  assert({
    given: 'two seats of one side, two sides, and two unsided speakers',
    should: 'join the side and keep each speaker apart',
    actual: [
      sameTeam(
        { kind: 'side', side: 'affirmative', slot: 0 },
        { kind: 'side', side: 'affirmative', slot: 1 },
      ),
      sameTeam(
        { kind: 'side', side: 'affirmative', slot: 0 },
        { kind: 'side', side: 'negative', slot: 0 },
      ),
      sameTeam({ kind: 'speaker', slot: 0 }, { kind: 'speaker', slot: 1 }),
      sameTeam({ kind: 'speaker', slot: 2 }, { kind: 'speaker', slot: 2 }),
      sameTeam(null, { kind: 'speaker', slot: 0 }),
    ],
    expected: [true, false, false, true, false],
  });
});
