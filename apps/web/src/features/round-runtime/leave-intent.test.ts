import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyRuntimeCheckpointFor,
  fourTeams,
  twoSides,
  type RoundView,
  type SeatRef,
} from '@daisy/protocol';
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
  const forfeit = (round: RoundView) => ({
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
      leaveIntent(view, aff.actorId, instantMs(at(0))),
      leaveIntent(speaking, aff.actorId, instantMs(at(startOf(0) + 1000))),
      leaveIntent(
        ran(rules.length, true),
        aff.actorId,
        instantMs(at(startOf(rules.length) + 1000)),
      ),
    ],
    expected: [forfeit(view), forfeit(speaking), { kind: 'freed' }],
  });
  assert({
    given: 'the judge and a viewer with no seat in a speaking Round',
    should: 'only navigate: neither can forfeit',
    actual: [judge.actorId, 'x'.repeat(24)].map((actorId) =>
      leaveIntent(speaking, actorId, instantMs(at(startOf(0) + 1000))),
    ),
    expected: [{ kind: 'navigate' }, { kind: 'navigate' }],
  });
});

test('only a debater is told they are freed while the ballot is pending (ISSUE-590)', () => {
  const judging = ran(rules.length, true);
  const after = instantMs(at(startOf(rules.length) + 1000));
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
  const pastPersistedPhase = instantMs(at(startOf(1) + 1000));
  assert({
    given: 'a debater whose speech ran out before the next phase persisted',
    should: 'hold them, because no command could confirm a departure',
    actual: leaveIntent(overran, aff.actorId, pastPersistedPhase),
    expected: { kind: 'held' },
  });
});

test('Leave in the opening follows the engine’s forfeit rule', () => {
  const opening = view;
  const held = {
    ...opening,
    checkpoint: {
      ...emptyRuntimeCheckpointFor({ sides: twoSides }),
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
      (round) => leaveIntent(round, aff.actorId, instantMs(at(0))).kind,
    ),
    expected: ['forfeit', 'held'],
  });
  assert({
    given: 'an opening Round whose checkpoint this view could not read',
    should: 'hold them, as an active Round does: nothing can be offered',
    actual: leaveIntent(
      { ...opening, checkpoint: null },
      aff.actorId,
      instantMs(at(0)),
    ).kind,
    expected: 'held',
  });
});

/** One-on-one's view, its two debaters moved onto `first` and `second` of `shape`. */
const reshapedView = (
  shape: Pick<RoundView['rules'], 'sides' | 'seats' | 'outcome'>,
  first: SeatRef,
  second: SeatRef,
): RoundView => {
  const speaking = ran(1);
  const affSide = aff.seat.kind === 'side' ? aff.seat.side : null;
  const move = (seat: SeatRef): SeatRef =>
    seat.kind === 'side' ? (seat.side === affSide ? first : second) : seat;
  return {
    ...speaking,
    rules: {
      ...speaking.rules,
      ...shape,
      segments: speaking.rules.segments.map((segment) => ({
        ...segment,
        speak:
          segment.speak.rights === 'one'
            ? { ...segment.speak, seat: move(segment.speak.seat) }
            : {
                ...segment.speak,
                ...(segment.speak.lead
                  ? { lead: move(segment.speak.lead) }
                  : {}),
              },
      })),
    },
    checkpoint: emptyRuntimeCheckpointFor(shape),
    participants: speaking.participants.map((participant) =>
      'seat' in participant && participant.seat.kind === 'side'
        ? { ...participant, seat: move(participant.seat) }
        : participant,
    ),
  } as RoundView;
};

const speakerSeat = (slot: number): SeatRef => ({ kind: 'speaker', slot });

/** The shapes no forfeit ends (TAB-6.8). */
const unforfeitable = [
  {
    name: 'a four-team Round',
    view: reshapedView(
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
  },
  {
    name: 'a six-speaker Round',
    view: reshapedView(
      {
        sides: [],
        seats: { sides: {}, speakers: 6, judges: 1, moderators: 0 },
        outcome: { kind: 'ranking', of: 'speakers' },
      },
      speakerSeat(0),
      speakerSeat(1),
    ),
  },
  {
    name: 'an open conversation',
    view: reshapedView(
      {
        sides: [],
        seats: { sides: {}, speakers: 2, judges: 0, moderators: 0 },
        outcome: { kind: 'none' },
      },
      speakerSeat(0),
      speakerSeat(1),
    ),
  },
] as const;

for (const shape of unforfeitable)
  test(`a debater leaves ${shape.name} as absence, never held for the whole debate (TAB-6.8)`, () => {
    const now = instantMs(at(startOf(0) + 1000));
    const left = {
      ...shape.view,
      checkpoint: {
        ...shape.view.checkpoint!,
        absent_participant_ids: [aff.id],
      },
    } as RoundView;
    assert({
      given: `a debater speaking in ${shape.name}, then the same debater once their seat has left`,
      should:
        'offer leaving that records the seat absent, then only navigate: the seat is gone',
      actual: [
        leaveIntent(shape.view, aff.actorId, now),
        leaveIntent(left, aff.actorId, now),
      ],
      expected: [
        {
          kind: 'leave',
          participantId: aff.id,
          expectedVersion: shape.view.version,
        },
        { kind: 'navigate' },
      ],
    });
  });
