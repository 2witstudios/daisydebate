import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { judgeSeat, sideSeat } from '@daisy/protocol/seats';
import { type RoomView } from '@daisy/protocol/room-contract';
import {
  overlaySeatRatings,
  ratedSeatActorIds,
  withSeatRatings,
  type SeatRatingState,
} from './room-seat-ratings';
setupRitewayBun();

const now = '2026-11-01T00:00:00.000Z';
const pool = {
  lobbyId: 'second-adult-lobby',
  ladderId: 'selected-league-ladder',
};
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
  ageRule: 'adults',
} as unknown as Pick<RoomView, 'participants' | 'ageRule'>;
const rated = (
  actorId: string,
  rating: number,
  deviation: number,
): SeatRatingState => ({
  actorId,
  ...pool,
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
  pool,
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

test('a Room uses the exact lobby and selected ladder for its seats', () => {
  const foreign = {
    ...rated(established, 1912, 60),
    lobbyId: 'first-adult-lobby',
  };
  const otherLadder = {
    ...rated(established, 1780, 60),
    ladderId: 'primary-ladder',
  };
  const selected = rated(established, 1613, 60);
  const rating = (rows: readonly SeatRatingState[]) => {
    const [participant] = overlaySeatRatings(view, {
      ratings: rows,
      blinded: [],
      now,
      pool,
    }).participants;
    return participant && !('anonymous' in participant)
      ? participant.rating
      : null;
  };
  assert({
    given: 'two adult lobbies and a Room pinned to its secondary league ladder',
    should: 'show only the stored pool and otherwise keep the seat unrated',
    actual: [
      rating([foreign, otherLadder, selected]),
      rating([foreign, otherLadder]),
    ],
    expected: [{ value: 1613, provisional: false }, null],
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
    pool,
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
    ageRule: 'adults',
  } as unknown as Pick<RoomView, 'participants' | 'ageRule'>;
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
    pool,
  );
  assert({
    given: 'a view with no seated human',
    should: 'read nothing',
    actual: read2,
    expected: 0,
  });
});

test('a social lane refusal for now shows the Room without seat ratings', async () => {
  const refused = (reason: 'expired' | 'saturated' | 'unconfigured') => () =>
    Promise.reject(refuseCapacity({ lane: 'social', reason }));
  const unrated = view.participants.map((p) =>
    'anonymous' in p ? p : { ...p, rating: null },
  );
  const reads = (failing: 'ratings' | 'blinded', error: () => Promise<never>) =>
    withSeatRatings(
      view,
      {
        ratings: failing === 'ratings' ? error : async () => ratings,
        blinded: failing === 'blinded' ? error : async () => [blinded],
      },
      now,
      pool,
    );
  assert({
    given: 'a ratings read the social lane refused after its wait',
    should: 'show every seat without a rating and keep the anonymous judge',
    actual: (await reads('ratings', refused('expired'))).participants,
    expected: unrated,
  });
  assert({
    given: 'a blinding read refused while the ratings read succeeded',
    should: 'show no rating at all, never an unblinded one',
    actual: (await reads('blinded', refused('saturated'))).participants,
    expected: unrated,
  });
  const failure = async (error: () => Promise<never>) => {
    try {
      await reads('ratings', error);
      return 'read';
    } catch {
      return 'failed';
    }
  };
  assert({
    given: 'a refusal that cannot clear, or a failure that is no refusal',
    should: 'still fail the Room read',
    actual: [
      await failure(refused('unconfigured')),
      await failure(() => Promise.reject(new Error('query failed'))),
    ],
    expected: ['failed', 'failed'],
  });
});
