import { assertRejects } from '@daisy/errors/testing';
import {
  emptyRuntimeCheckpointFor,
  fourTeams,
  type RoundParticipantSeat,
  type RoundRules,
  type SeatRef,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCommandOptions } from './round-command-legality';
import { normalizeRoundClock } from './round-clock-state';
import { oneOnOneRules, roundAt, runtimeWorld } from './runtime.test-support';

setupRitewayBun();

/** One-on-one's schedule, its two speaking seats moved onto `first` and `second`. */
const reshaped = (
  shape: Pick<RoundRules, 'sides' | 'seats' | 'outcome'>,
  first: SeatRef,
  second: SeatRef,
): RoundRules => {
  const rules = oneOnOneRules();
  const [affirmative] = rules.sides;
  const move = (seat: SeatRef): SeatRef =>
    seat.kind === 'side'
      ? seat.side === affirmative!.key
        ? first
        : second
      : seat;
  return {
    ...rules,
    ...shape,
    segments: rules.segments.map((segment) => ({
      ...segment,
      speak:
        segment.speak.rights === 'one'
          ? { ...segment.speak, seat: move(segment.speak.seat) }
          : {
              ...segment.speak,
              ...(segment.speak.lead ? { lead: move(segment.speak.lead) } : {}),
            },
    })),
  } as RoundRules;
};

const id = (n: number) => `s${String(n).padStart(23, '0')}`;
const actor = (n: number) => `a${String(n).padStart(23, '0')}`;
const seated = (seats: readonly SeatRef[]): RoundParticipantSeat[] =>
  seats.map((seat, n) => ({ id: id(n), actorId: actor(n), seat }));
const speaker = (slot: number): SeatRef => ({ kind: 'speaker', slot });
const judge: SeatRef = { kind: 'judge', slot: 0 };

/** The three shapes no forfeit ends (TAB-6.8): four teams, six speakers, an open conversation. */
const shapes = [
  {
    name: 'a four-team Round ranked by sides',
    rules: reshaped(
      {
        sides: [...fourTeams],
        seats: {
          sides: Object.fromEntries(fourTeams.map((team) => [team.key, 1])),
          speakers: 0,
          judges: 1,
          moderators: 0,
        },
        outcome: { kind: 'ranking', of: 'sides' },
      },
      { kind: 'side', side: fourTeams[0].key, slot: 0 },
      { kind: 'side', side: fourTeams[1].key, slot: 0 },
    ),
    participants: seated([
      ...fourTeams.map((team): SeatRef => ({
        kind: 'side',
        side: team.key,
        slot: 0,
      })),
      judge,
    ]),
  },
  {
    name: 'a six-speaker Round ranked by speakers',
    rules: reshaped(
      {
        sides: [],
        seats: { sides: {}, speakers: 6, judges: 1, moderators: 0 },
        outcome: { kind: 'ranking', of: 'speakers' },
      },
      speaker(0),
      speaker(1),
    ),
    participants: seated([0, 1, 2, 3, 4, 5].map(speaker).concat(judge)),
  },
  {
    name: 'an open conversation nobody judges',
    rules: reshaped(
      {
        sides: [],
        seats: { sides: {}, speakers: 2, judges: 0, moderators: 0 },
        outcome: { kind: 'none' },
      },
      speaker(0),
      speaker(1),
    ),
    participants: seated([speaker(0), speaker(1)]),
  },
] as const;

/** A world of `shape` started and ticked into its first speech. */
const live = (shape: (typeof shapes)[number]) => {
  const world = runtimeWorld({
    rules: shape.rules,
    participants: shape.participants,
    checkpoint: emptyRuntimeCheckpointFor(shape.rules),
  });
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(20_000));
  return world;
};

for (const shape of shapes)
  test(`leaving ${shape.name} records the seat absent and the Round goes on (TAB-6.8)`, async () => {
    const world = live(shape);
    const leaver = shape.participants[1]!;
    const stayer = shape.participants[0]!;
    /** The seat's facts in the first speech, before or after `absent` left. */
    const facts = (seat: RoundParticipantSeat, absent: readonly string[]) => {
      const rules = shape.rules;
      return {
        rules,
        participants: shape.participants,
        seat,
        nowMs: Date.parse(roundAt(1_000)),
        state: normalizeRoundClock({
          round: {
            status: 'active',
            startedAt: roundAt(0),
            completedAt: null,
            outcome: null,
          },
          rules,
          checkpoint: {
            ...emptyRuntimeCheckpointFor(rules),
            ...(absent.length > 0 ? { absent_participant_ids: absent } : {}),
          },
          segments: [
            {
              id: 'segment-0',
              sequence: 0,
              type: rules.segments[0]!.type,
              rulesSegmentKey: rules.segments[0]!.key,
              startedAt: roundAt(0),
              endedAt: null,
              durationMs: rules.segments[0]!.durationMs,
              returnedMs: 0,
            },
          ],
        }),
      };
    };
    const offeredBefore = roundCommandOptions(facts(leaver, [])).filter(
      (option) => option.type === 'leave' || option.type === 'forfeit',
    );
    await assertRejects({
      given: `a competitor forfeiting ${shape.name}`,
      should: 'refuse: there is no other side to hand the win to',
      actual: () =>
        world.execute({
          command: { type: 'forfeit' },
          actorId: leaver.actorId,
          now: roundAt(21_000),
        }),
      code: 'CONFLICT',
    });
    const left = world.execute({
      command: { type: 'leave' },
      actorId: leaver.actorId,
      now: roundAt(21_000),
    });
    await assertRejects({
      given: 'the seat that left leaving again',
      should: 'refuse: it commands nothing more',
      actual: () =>
        world.execute({
          command: { type: 'leave' },
          actorId: leaver.actorId,
          now: roundAt(22_000),
        }),
      code: 'CONFLICT',
    });
    assert({
      given: `a competitor leaving ${shape.name} during its first speech`,
      should:
        'offer leave, not forfeit, then keep the Round active with that seat absent, free its member, and offer the seat nothing more while the others keep theirs',
      actual: {
        offeredBefore,
        status: left.round?.status,
        absent: left.round?.checkpoint.absent_participant_ids,
        released: left.releasesMembers,
        releasesEveryone: left.releasesRoomMembers ?? false,
        leaverOptions: roundCommandOptions(facts(leaver, [leaver.id])),
        stayerLeaves: roundCommandOptions(facts(stayer, [leaver.id])).some(
          (option) => option.type === 'leave' && option.legal,
        ),
      },
      expected: {
        offeredBefore: [{ type: 'leave', legal: true }],
        status: 'active',
        absent: [leaver.id],
        released: [leaver.actorId],
        releasesEveryone: false,
        leaverOptions: [],
        stayerLeaves: true,
      },
    });
  });

test('a two-sided Round decided by a winner is forfeited, never left', async () => {
  const world = runtimeWorld();
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(20_000));
  await assertRejects({
    given: 'a debater posting leave in a one-on-one Round',
    should: 'refuse: leaving it is the forfeit',
    actual: () =>
      world.execute({
        command: { type: 'leave' },
        actorId: 'a7b3c9d1e5f2k4m6n8p1r3t5',
        now: roundAt(21_000),
      }),
    code: 'CONFLICT',
  });
});
