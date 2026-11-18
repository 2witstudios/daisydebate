import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RatingDivision, SeatRef } from '@daisy/protocol';
import { rankedSeatClaimRefusal } from './ladder-seating';

setupRitewayBun();

const aff: SeatRef = { kind: 'side', side: 'affirmative', slot: 0 };
const neg: SeatRef = { kind: 'side', side: 'negative', slot: 0 };
const judge: SeatRef = { kind: 'judge', slot: 0 };

const person = (
  actorId: string,
  division: RatingDivision | null,
  seat: SeatRef,
) => ({ actorId, kind: 'human' as const, division, seat });

const ranked = (participants: ReturnType<typeof person>[]) => ({
  competitionType: 'ranked' as const,
  participants,
});

test('rankedSeatClaimRefusal', () => {
  const youthRoom = ranked([person('maya', 'youth', aff)]);
  const claim = { type: 'claim-seat' as const, seat: neg };
  assert({
    given: 'an adult claiming a debater seat on a Youth ranked Room',
    should: 'refuse with the division reason',
    actual: rankedSeatClaimRefusal(youthRoom, claim, person('devon', 'open', neg)),
    expected: 'ranked-division',
  });
  assert({
    given: 'a minor claiming a debater seat on an Open ranked Room',
    should: 'refuse with the division reason',
    actual: rankedSeatClaimRefusal(
      ranked([person('devon', 'open', aff)]),
      claim,
      person('maya', 'youth', neg),
    ),
    expected: 'ranked-division',
  });
  assert({
    given: 'a youth member claiming on a Youth ranked Room',
    should: 'seat them',
    actual: rankedSeatClaimRefusal(youthRoom, claim, person('jules', 'youth', neg)),
    expected: null,
  });
  assert({
    given: 'the first debater claiming on a ranked Room with no debater yet',
    should: 'seat them on either division: they set the ladder',
    actual: [
      rankedSeatClaimRefusal(ranked([]), claim, person('a', 'open', aff)),
      rankedSeatClaimRefusal(ranked([]), claim, person('b', 'youth', aff)),
    ],
    expected: [null, null],
  });
  assert({
    given: 'an adult claiming the judge seat of a Youth ranked Room',
    should: 'seat them: anyone can judge',
    actual: rankedSeatClaimRefusal(
      youthRoom,
      { type: 'claim-seat', seat: judge },
      person('devon', 'open', judge),
    ),
    expected: null,
  });
  assert({
    given: 'a host assigning an adult to a Youth ranked Room',
    should: 'not refuse: a mixed seating plays casual',
    actual: rankedSeatClaimRefusal(
      youthRoom,
      { type: 'assign-seat', seat: neg },
      person('devon', 'open', neg),
    ),
    expected: null,
  });
  assert({
    given: 'a member with no division claiming a ranked debater seat',
    should: 'refuse: no ladder holds them',
    actual: rankedSeatClaimRefusal(ranked([]), claim, person('x', null, aff)),
    expected: 'ranked-division',
  });
  assert({
    given: 'a member moving seats within a Youth Room they set alone',
    should: 'judge them against the others, not themselves',
    actual: rankedSeatClaimRefusal(
      ranked([person('devon', 'open', aff)]),
      claim,
      person('devon', 'open', neg),
    ),
    expected: null,
  });
  assert({
    given: 'any claim on a casual Room',
    should: 'never refuse for division',
    actual: rankedSeatClaimRefusal(
      { competitionType: 'casual', participants: youthRoom.participants },
      claim,
      person('devon', 'open', neg),
    ),
    expected: null,
  });
});
