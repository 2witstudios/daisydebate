import { assert, setupRitewayBun, test } from 'riteway/bun';
import { judgeSeat, sideSeat, type RoomView } from '@daisy/protocol';
import {
  overlaySeatRatings,
  ratedSeatActorIds,
  withSeatRatings,
  type SeatRatingState,
} from './room-seat-ratings';
setupRitewayBun();

const now = '2026-11-01T00:00:00.000Z';
const seatState = {
  needsReady: true,
  ready: 'not-ready' as const,
  eligible: true,
};
const seat = (
  actorId: string,
  kind: 'human' | 'bot',
  role: 'affirmative' | 'negative' | 'judge',
  slot = 0,
) => ({
  id: `p${actorId.slice(1)}`,
  actorId,
  kind,
  label: actorId,
  consentVersion: 0,
  seat: role === 'judge' ? judgeSeat(slot) : sideSeat(role, slot),
  teamOpen: false,
  positionOpen: false,
  rating: null,
  division: null,
  ...seatState,
});
const established = 'a1aaaaaaaaaaaaaaaaaaaaaa';
const provisional = 'a2aaaaaaaaaaaaaaaaaaaaaa';
const blinded = 'a3aaaaaaaaaaaaaaaaaaaaaa';
const unrated = 'a4aaaaaaaaaaaaaaaaaaaaaa';
const bot = 'b1aaaaaaaaaaaaaaaaaaaaaa';
const anonymousJudge = {
  seat: { kind: 'judge' as const, slot: 0 },
  kind: 'human' as const,
  anonymous: true as const,
  ...seatState,
};
const view = {
  participants: [
    seat(established, 'human', 'affirmative'),
    seat(provisional, 'human', 'negative'),
    seat(blinded, 'human', 'affirmative', 1),
    seat(unrated, 'human', 'negative', 1),
    seat(bot, 'bot', 'judge', 1),
    anonymousJudge,
  ],
} as unknown as Pick<RoomView, 'participants'>;
const rated = (
  actorId: string,
  rating: number,
  deviation: number,
): SeatRatingState => ({
  actorId,
  ladder: 'freestyle',
  division: 'open',
  rating,
  deviation,
  volatility: 0.06,
  lastRatedAt: now,
});
const ratings = [
  rated(established, 1612.6, 60),
  rated(provisional, 1500.4, 300),
  rated(blinded, 1800, 60),
  // A bot never stands on a ladder; were a row there, it still shows none.
  rated(bot, 1700, 60),
];
const overlaid = overlaySeatRatings(view, {
  ratings,
  blinded: [blinded],
  now,
});
const ratingOf = (index: number) => {
  const p = overlaid.participants[index]!;
  return 'anonymous' in p ? 'no field' : p.rating;
};

test('a Room view carries each seated human rating under the viewer blinding', () => {
  assert({
    given: 'an established human seat with a rating',
    should: 'carry the whole-number rating, not provisional',
    actual: ratingOf(0),
    expected: { value: 1613, provisional: false },
  });
  assert({
    given: 'a human seat whose deviation is still wide',
    should: 'carry the rounded rating marked provisional',
    actual: ratingOf(1),
    expected: { value: 1500, provisional: true },
  });
  assert({
    given: 'a seat this viewer is blinded to before their ballot',
    should: 'carry no rating',
    actual: ratingOf(2),
    expected: null,
  });
  assert({
    given: 'a human seat with no rating row',
    should: 'carry no rating',
    actual: ratingOf(3),
    expected: null,
  });
  assert({
    given: 'a bot seat',
    should: 'carry no rating',
    actual: ratingOf(4),
    expected: null,
  });
  assert({
    given: 'an anonymous judge',
    should: 'leave the row untouched, with no rating field',
    actual: overlaid.participants[5],
    expected: anonymousJudge,
  });
});

test('a Room view reads ratings once for all its seated humans', async () => {
  assert({
    given: 'a view with humans, a bot and an anonymous judge',
    should: 'name only the seated humans to read',
    actual: ratedSeatActorIds(view),
    expected: [established, provisional, blinded, unrated],
  });
  const calls: string[][] = [];
  let blindings = 0;
  const read = await withSeatRatings(
    view,
    {
      ratings: async (actorIds) => {
        calls.push([...actorIds]);
        return ratings;
      },
      blinded: async () => {
        blindings += 1;
        return [blinded];
      },
    },
    now,
  );
  assert({
    given: 'four seated humans',
    should: 'make one batched ratings read and one blinding read',
    actual: { calls, blindings },
    expected: {
      calls: [[established, provisional, blinded, unrated]],
      blindings: 1,
    },
  });
  assert({
    given: 'the batched reads',
    should: 'overlay the same ratings as the pure rule',
    actual: read,
    expected: overlaid,
  });
  const botsOnly = {
    participants: [seat(bot, 'bot', 'affirmative')],
  } as unknown as Pick<RoomView, 'participants'>;
  let read2 = 0;
  await withSeatRatings(
    botsOnly,
    {
      ratings: async () => {
        read2 += 1;
        return [];
      },
      blinded: async () => {
        read2 += 1;
        return [];
      },
    },
    now,
  );
  assert({
    given: 'a view with no seated human',
    should: 'read nothing',
    actual: read2,
    expected: 0,
  });
});
