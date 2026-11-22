import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  RoomAssemblyState,
  RoomCommand,
} from '@daisy/protocol/room-contract';
import { affirmativeSide, fourTeams, sideSeat } from '@daisy/protocol/seats';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { resolveSeats } from './room-seats';
import { bytesOf } from './draw-random';

setupRitewayBun();

type Participant = RoomAssemblyState['participants'][number];

/** A seat's side (or kind) and slot, as the pre-TAB-6 tests read it. */
const roleOf = (p: Participant) =>
  p.seat.kind === 'side' ? p.seat.side : p.seat.kind;
const at = (p: Participant) => `${roleOf(p)}:${p.seat.slot}`;

const debater = (
  id: string,
  role: 'affirmative' | 'negative',
  slot: number,
  open: Partial<Pick<Participant, 'teamOpen' | 'positionOpen'>> = {},
): Participant => ({
  id,
  actorId: id === 'p1' ? 'host' : `actor-${id}`,
  label: id,
  kind: 'human',
  seat: sideSeat(role, slot),
  teamOpen: open.teamOpen ?? false,
  positionOpen: open.positionOpen ?? open.teamOpen ?? false,
  eligible: true,
  consentVersion: 0,
  consentCommandId: `ready-${id}`,
});

/** A 2 v 2 Room: team 1 holds the affirmative seats, team 2 the negative. */
const twoVsTwo = (
  participants: readonly Participant[],
  teamOneSide: RoomAssemblyState['teamOneSide'] = null,
): RoomAssemblyState => {
  const room = state();
  return {
    ...room,
    teamOneSide,
    rules: {
      ...room.rules,
      seats: {
        ...room.rules.seats,
        sides: { affirmative: 2, negative: 2 },
        judges: 0,
      },
    },
    participants,
  };
};

const full = (open: Record<string, Partial<Participant>> = {}) =>
  twoVsTwo([
    debater('p1', 'affirmative', 0, open.p1),
    debater('p2', 'affirmative', 1, open.p2),
    debater('p3', 'negative', 0, open.p3),
    debater('p4', 'negative', 1, open.p4),
  ]);

const command = (room: RoomAssemblyState, body: object) =>
  ({
    commandId: 'cmd',
    expectedVersion: room.version,
    ...body,
  }) as RoomCommand;

const seatsOf = (room: RoomAssemblyState) =>
  Object.fromEntries(
    room.participants.map((p) => [
      p.id,
      `${at(p)}${p.teamOpen ? ':team?' : ''}${p.positionOpen ? ':pos?' : ''}`,
    ]),
  );

const run = (room: RoomAssemblyState, actor: string, body: object) =>
  executeRoomCommand(room, actor, command(room, body), consent, edges);

const seed = (n: number) => bytesOf(n.toString(16).padStart(64, '0'));

describe('set-seat', () => {
  test('moving to a team with an open seat', () => {
    const room = twoVsTwo([
      debater('p1', 'affirmative', 0),
      debater('p2', 'affirmative', 1),
      debater('p3', 'negative', 0),
    ]);
    const outcome = run(room, 'actor-p2', {
      type: 'set-seat',
      participantId: 'p2',
      team: 2,
      position: null,
    });
    assert({
      given: 'a debater choosing team 2 with its position open',
      should: 'take the free team 2 seat and clear every Ready',
      actual: outcome.ok && {
        seats: seatsOf(outcome.mutation.state),
        ready: outcome.mutation.state.participants.map(
          (p) => p.consentCommandId,
        ),
      },
      expected: {
        seats: {
          p1: 'affirmative:0',
          p2: 'negative:1:pos?',
          p3: 'negative:0',
        },
        ready: [null, null, null],
      },
    });
  });

  test('swapping with a debater whose team is ?', () => {
    const outcome = run(full({ p3: { teamOpen: true } }), 'actor-p2', {
      type: 'set-seat',
      participantId: 'p2',
      team: 2,
      position: 0,
    });
    assert({
      given: 'a full team 2 whose first seat holds a ? debater',
      should: 'swap seats with that debater',
      actual: outcome.ok && seatsOf(outcome.mutation.state),
      expected: {
        p1: 'affirmative:0',
        p2: 'negative:0',
        p3: 'affirmative:1:team?:pos?',
        p4: 'negative:1',
      },
    });
  });

  test('a seat held by a placed debater', () => {
    assert({
      given: 'a full team 2 whose debaters both chose their seats',
      should: 'refuse the move',
      actual: run(full(), 'actor-p2', {
        type: 'set-seat',
        participantId: 'p2',
        team: 2,
        position: 0,
      }),
      expected: { ok: false, refusal: 'seat-unavailable' },
    });
  });

  test('swapping positions with a teammate on ?', () => {
    const outcome = run(full({ p2: { positionOpen: true } }), 'host', {
      type: 'set-seat',
      participantId: 'p1',
      team: 1,
      position: 1,
    });
    assert({
      given: 'a debater taking the position a ? teammate holds',
      should: 'swap their positions',
      actual: outcome.ok && seatsOf(outcome.mutation.state),
      expected: {
        p1: 'affirmative:1',
        p2: 'affirmative:0:pos?',
        p3: 'negative:0',
        p4: 'negative:1',
      },
    });
  });

  test('someone else moving a debater', () => {
    assert({
      given: 'a debater who is not the host moving another debater',
      should: 'refuse',
      actual: run(full(), 'actor-p3', {
        type: 'set-seat',
        participantId: 'p4',
        team: null,
        position: null,
      }),
      expected: { ok: false, refusal: 'host-required' },
    });
  });
});

describe('set-sides', () => {
  test('a debater fixing the sides', () => {
    const outcome = run(full(), 'actor-p3', {
      type: 'set-sides',
      teamOneSide: 'negative',
    });
    assert({
      given: 'a debater choosing team 1 to argue Negative',
      should: 'fix team 1 on Negative',
      actual: outcome.ok && outcome.mutation.state.teamOneSide,
      expected: 'negative',
    });
  });

  test('a ranked Room', () => {
    assert({
      given: 'a ranked Room',
      should: 'keep its sides open to the coin flip',
      actual: run({ ...full(), competitionType: 'ranked' }, 'host', {
        type: 'set-sides',
        teamOneSide: 'affirmative',
      }),
      expected: { ok: false, refusal: 'illegal-config' },
    });
  });

  test('teams of different sizes', () => {
    const room = full();
    assert({
      given: 'a format whose sides seat different numbers of debaters',
      should: 'keep each team on the side its seats were declared for',
      actual: run(
        {
          ...room,
          rules: {
            ...room.rules,
            seats: {
              ...room.rules.seats,
              sides: { affirmative: 2, negative: 3 },
              judges: 0,
            },
          },
        },
        'host',
        { type: 'set-sides', teamOneSide: null },
      ),
      expected: { ok: false, refusal: 'illegal-config' },
    });
  });
});

describe('resolveSeats', () => {
  test('the same seed and seats', () => {
    const room = full({ p2: { teamOpen: true }, p3: { teamOpen: true } });
    const once = resolveSeats(room, { seed: seed(7), roundId: 'r1' });
    const again = resolveSeats(room, { seed: seed(7), roundId: 'r1' });
    assert({
      given: 'the same seed, Round and seats',
      should: 'resolve to the same Round and commitment',
      actual: JSON.stringify(once),
      expected: JSON.stringify(again),
    });
  });

  test('fixed seats and fixed sides', () => {
    const resolved = resolveSeats(
      { ...full(), teamOneSide: 'affirmative' },
      { seed: seed(1), roundId: 'r1' },
    );
    assert({
      given: 'sides fixed and no ? anywhere',
      should: 'not move anyone',
      actual: resolved.participants.length > 0 && {
        coin: resolved.seatDraw?.coin,
        moved: resolved.seatDraw?.moved.length,
        seats: seatsOf({ ...full(), participants: resolved.participants }),
      },
      expected: {
        coin: null,
        moved: 0,
        seats: {
          p1: 'affirmative:0',
          p2: 'affirmative:1',
          p3: 'negative:0',
          p4: 'negative:1',
        },
      },
    });
  });

  test('a team fixed on Negative', () => {
    const resolved = resolveSeats(
      { ...full(), teamOneSide: 'affirmative' },
      { seed: seed(1), roundId: 'r1' },
    );
    const negative = resolveSeats(
      { ...full(), teamOneSide: 'negative' },
      { seed: seed(1), roundId: 'r1' },
    );
    assert({
      given: 'team 1 fixed on Negative',
      should: 'seat team 1 on the negative side',
      actual: [
        resolved.teamOneSide,
        negative.participants
          .filter((p) => roleOf(p) === 'negative')
          .map((p) => p.id),
      ],
      expected: ['affirmative', ['p1', 'p2']],
    });
  });

  test('the coin over many seeds', () => {
    const room = full();
    const flips = Array.from({ length: 400 }, (_, i) =>
      resolveSeats(
        { ...room, teamOneSide: null },
        { seed: seed(i), roundId: 'r' },
      ),
    );
    const swapped = flips.filter((f) => f.seatDraw?.coin === 'swapped').length;
    assert({
      given: 'open sides across 400 seeds',
      should: 'land both ways, close to even',
      actual: swapped > 160 && swapped < 240,
      expected: true,
    });
  });

  test('open teams and positions', () => {
    const room = full({ p1: { teamOpen: true }, p4: { teamOpen: true } });
    const outcomes = new Set(
      Array.from({ length: 64 }, (_, i) => {
        const resolved = resolveSeats(
          { ...room, teamOneSide: 'affirmative' },
          { seed: seed(i), roundId: 'r' },
        );
        const p1 = resolved.participants.find((p) => p.id === 'p1')!;
        return at(p1);
      }),
    );
    const one = resolveSeats(
      { ...room, teamOneSide: 'affirmative' },
      { seed: seed(3), roundId: 'r' },
    );
    assert({
      given: 'two ? debaters on different teams',
      should:
        'place them over the seats they held, every way, and keep the placed debaters still',
      actual: {
        outcomes: [...outcomes].sort(),
        placed: one.participants
          .filter((p) => p.id === 'p2' || p.id === 'p3')
          .map(at),
        cleared: one.participants.every((p) => !p.teamOpen && !p.positionOpen),
      },
      expected: {
        outcomes: ['affirmative:0', 'negative:1'],
        placed: ['affirmative:1', 'negative:0'],
        cleared: true,
      },
    });
  });
});

describe('Start round', () => {
  test('open sides', () => {
    const room = { ...state(), teamOneSide: null };
    const outcome = executeRoomCommand(
      room,
      'host',
      command(room, { type: 'start-round' }),
      consent,
      edges,
    );
    assert({
      given: 'a Room whose sides are open',
      should: 'flip them, freeze concrete sides and keep the draw',
      actual: outcome.ok && {
        coin: outcome.mutation.seatDraw?.coin !== null,
        sides: outcome.mutation.state.participants.map(roleOf).sort(),
        teamOneSide: outcome.mutation.state.teamOneSide,
      },
      expected: {
        coin: true,
        sides: ['affirmative', 'negative'],
        teamOneSide: 'affirmative',
      },
    });
  });
});

describe('an event Room (ADR 0145, Tab)', () => {
  test('seats and sides from the draw', () => {
    const room = {
      ...full(),
      hostActorId: null,
      teamOneSide: 'affirmative',
    } as const;
    const debater = room.participants[2]!;
    assert({
      given:
        'an event Room no person hosts, its sides fixed by the draw, and a seated debater',
      should: 'refuse moving a seat and changing the sides',
      actual: [
        run(room, debater.actorId, {
          type: 'set-seat',
          participantId: debater.id,
          team: 1,
          position: null,
        }),
        run(room, debater.actorId, { type: 'set-sides', teamOneSide: null }),
      ],
      expected: [
        { ok: false, refusal: 'host-required' },
        { ok: false, refusal: 'host-required' },
      ],
    });
  });
});

describe('a Room with no two teams (TAB-6.2)', () => {
  // Four one-seat benches: every seat is its side, so nothing is `?`.
  const benches = fourTeams.map((side) => side.key);
  const fourSides = (): RoomAssemblyState => {
    const room = state();
    return {
      ...room,
      teamOneSide: affirmativeSide,
      rules: {
        ...room.rules,
        sides: [...fourTeams],
        seats: {
          ...room.rules.seats,
          sides: Object.fromEntries(benches.map((key) => [key, 1])),
          judges: 0,
        },
      },
      participants: benches.map((key, i) => ({
        ...debater(`b${i}`, 'affirmative', 0),
        actorId: i === 0 ? 'host' : `actor-b${i}`,
        seat: sideSeat(key),
      })),
    };
  };

  test('moving a seat and setting sides', () => {
    const room = fourSides();
    const own = room.participants[0]!;
    assert({
      given:
        'a four-bench Room and its host moving their own seat, then setting the sides',
      should: 'refuse both: the format has no teams and no coin',
      actual: [
        run(room, 'host', {
          type: 'set-seat',
          participantId: own.id,
          team: null,
          position: null,
        }),
        run(room, 'host', { type: 'set-sides', teamOneSide: 'affirmative' }),
      ],
      expected: [
        { ok: false, refusal: 'illegal-config' },
        { ok: false, refusal: 'illegal-config' },
      ],
    });
  });

  test('Start round', () => {
    const room = fourSides();
    const resolved = resolveSeats(room, { seed: seed(5), roundId: 'r1' });
    assert({
      given: 'a four-bench Room at Start round',
      should: 'keep every seat as it is and freeze no seat draw',
      actual: {
        seats: resolved.participants.map(at),
        seatDraw: resolved.seatDraw,
      },
      expected: {
        seats: room.participants.map(at),
        seatDraw: null,
      },
    });
  });
});
