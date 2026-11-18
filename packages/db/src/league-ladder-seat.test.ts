import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leagueLadderSeatFits, seatableInRoom } from './league-ladder-seat';
setupRitewayBun();

type Actor = {
  readonly kind: 'human' | 'bot';
  readonly division: 'open' | 'youth' | null;
  readonly eligible: boolean;
};
const human = (division: Actor['division']): Actor => ({
  kind: 'human',
  division,
  eligible: true,
});
const bot: Actor = { kind: 'bot', division: null, eligible: true };

test('leagueLadderSeatFits (PYL-16)', () => {
  const youth = { leagueDivision: 'youth' } as const;
  const open = { leagueDivision: 'open' } as const;
  const daisy = { leagueDivision: null } as const;
  assert({
    given: 'a Youth league Room',
    should:
      'seat debaters under 18 and bots, and nobody 18 or over or without an age',
    actual: [human('youth'), human('open'), human(null), bot].map((actor) =>
      leagueLadderSeatFits(youth, actor),
    ),
    expected: [true, false, false, true],
  });
  assert({
    given: 'an Open league Room',
    should: 'seat debaters 18 and over and bots only',
    actual: [human('youth'), human('open'), human(null), bot].map((actor) =>
      leagueLadderSeatFits(open, actor),
    ),
    expected: [false, true, false, true],
  });
  assert({
    given: 'a Room on no league ladder',
    should: 'leave the seat to the Room’s other rules',
    actual: [human('youth'), human('open'), human(null)].map((actor) =>
      leagueLadderSeatFits(daisy, actor),
    ),
    expected: [true, true, true],
  });
  assert({
    given: 'an Open debater in a Youth league Room',
    should: 'keep them but mark them ineligible',
    actual: seatableInRoom(youth, human('open')),
    expected: { kind: 'human', division: 'open', eligible: false },
  });
});
