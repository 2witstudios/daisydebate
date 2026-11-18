import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyRuntimeCheckpointFor,
  isNamedSeat,
  roundViewSchema,
} from './index';
import { twoSides } from './seats';
import {
  fixtureRules,
  plainRoomConfig,
  oneOnOneFormatFixture,
} from './format-fixtures.test-support';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const at = (minute: number) =>
  `2026-10-12T18:${String(minute).padStart(2, '0')}:00.000Z`;
const rules = fixtureRules(oneOnOneFormatFixture);
const segment = (sequence: number) => ({
  id: id(String.fromCharCode(97 + sequence)),
  sequence,
  type: rules.segments[sequence]!.type,
  rulesSegmentKey: rules.segments[sequence]!.key,
  startedAt: at(sequence * 5),
  endedAt: at(sequence * 5 + 5),
  durationMs: rules.segments[sequence]!.durationMs,
  returnedMs: 0,
});
const debater = {
  id: id('p'),
  actorId: id('q'),
  kind: 'human',
  label: 'Sam Reyes',
  seat: { kind: 'side', side: 'affirmative', slot: 0 },
} as const;
const anonymousJudge = {
  seat: { kind: 'judge', slot: 0 },
  kind: 'human',
  anonymous: true,
} as const;
const view = {
  id: id('r'),
  roomId: id('m'),
  version: 3,
  status: 'active',
  competitionType: 'ranked',
  ladder: { style: 'freestyle', division: 'open' },
  topic: 'A topic',
  opening: null,
  visibility: 'public',
  config: plainRoomConfig,
  rules,
  participants: [debater, anonymousJudge],
  startedAt: at(0),
  completedAt: null,
  outcome: null,
  panelRuling: null,
  platformEnding: null,
  postRoundCall: false,
  waitingOn: null,
  transcriptCompleteness: null,
  resolutionAudit: null,
  viewerIsHost: false,
  checkpoint: emptyRuntimeCheckpointFor({ sides: twoSides }),
  segments: [segment(0), segment(1)],
};
const parses = (value: unknown) => roundViewSchema.safeParse(value).success;

describe('roundViewSchema', () => {
  test('the runtime snapshot', () => {
    assert({
      given:
        'a ranked active Round with its checkpoint and two segments in order, and the same with an unreadable checkpoint',
      should:
        'accept both: an unreadable checkpoint reads as null, not an error',
      actual: [parses(view), parses({ ...view, checkpoint: null })],
      expected: [true, true],
    });
  });

  test('refusals', () => {
    assert({
      given:
        'segments out of order, a gap in sequence, an unknown competition type, a malformed checkpoint and a missing snapshot',
      should: 'refuse each',
      actual: [
        parses({ ...view, segments: [segment(1), segment(0)] }),
        parses({ ...view, segments: [segment(1)] }),
        parses({ ...view, competitionType: 'tournament' }),
        parses({ ...view, checkpoint: { version: 1 } }),
        parses((({ segments: _s, ...rest }) => rest)(view)),
      ],
      expected: [false, false, false, false, false],
    });
  });

  test('the unjudged ruling (DEC-208)', () => {
    assert({
      given:
        'a completed view ruled transcript-incomplete, an unknown ruling, and a view without the field',
      should: 'carry the receipt ruling and refuse the others',
      actual: [
        parses({
          ...view,
          status: 'completed',
          completedAt: at(9),
          panelRuling: 'transcript-incomplete',
          platformEnding: null,
          postRoundCall: false,
        }),
        parses({ ...view, panelRuling: 'media-failed' }),
        parses((({ panelRuling: _u, ...rest }) => rest)(view)),
      ],
      expected: [true, false, false],
    });
  });

  test('a view is one lifecycle, never two', () => {
    const completed = { ...view, status: 'completed', completedAt: at(9) };
    const abandoned = {
      ...view,
      status: 'abandoned',
      startedAt: null,
      completedAt: at(9),
    };
    const opening = { ...view, status: 'opening', startedAt: null };
    assert({
      given:
        'an opening, an active, a completed and an abandoned Round, each holding what its status can',
      should: 'accept each',
      actual: [opening, view, completed, abandoned].map(parses),
      expected: [true, true, true, true],
    });
    assert({
      given:
        'an active Round with no start, with an end or with an outcome; a completed Round with no end; an abandoned Round with an outcome; an opening that started',
      should: 'refuse each: the status and its instants disagree',
      actual: [
        parses({ ...view, startedAt: null }),
        parses({ ...view, completedAt: at(9) }),
        parses({ ...view, outcome: { kind: 'winner', side: 'affirmative' } }),
        parses({ ...view, status: 'completed' }),
        parses({ ...abandoned, outcome: { kind: 'winner', side: 'negative' } }),
        parses({ ...opening, startedAt: at(0) }),
      ],
      expected: [false, false, false, false, false, false],
    });
  });

  test('the sides result an opening carries', () => {
    const sides = {
      algorithm: 'daisy-draw-v1/seats',
      commitment: '0'.repeat(64),
      coin: 'kept',
      teamOneSide: 'affirmative',
      moved: [
        {
          participantId: id('p'),
          open: ['position'],
          from: { role: 'negative', slot: 0 },
          to: { role: 'negative', slot: 1 },
        },
      ],
    };
    const opening = (value: unknown) => ({
      ...view,
      status: 'opening',
      startedAt: null,
      opening: {
        step: { step: 'strike' },
        draw: null,
        canStrike: false,
        sides: value,
      },
    });
    assert({
      given: 'a seat draw, none, a missing one and one with a secret field',
      should: 'accept the first two and refuse the rest',
      actual: [
        parses(opening(sides)),
        parses(opening(null)),
        parses(opening(undefined)),
        parses(opening({ ...sides, seed: '0'.repeat(64) })),
      ],
      expected: [true, true, false, false],
    });
  });

  test('what only one status carries', () => {
    const opening = {
      ...view,
      status: 'opening',
      startedAt: null,
      opening: {
        step: { step: 'strike' },
        draw: null,
        canStrike: false,
        sides: null,
      },
    };
    const completed = { ...view, status: 'completed', completedAt: at(9) };
    const waitingOn = { state: 'settling' };
    assert({
      given:
        'an opening Round reading its opening, an active Round waiting, a recovery-bound abandonment and a capture shortfall with no outcome',
      should: 'accept each',
      actual: [
        parses(opening),
        parses({ ...view, waitingOn }),
        parses({
          ...completed,
          status: 'abandoned',
          platformEnding: 'recovery_bound',
        }),
        parses({ ...completed, platformEnding: 'capture_shortfall' }),
      ],
      expected: [true, true, true, true],
    });
    assert({
      given:
        'an active Round carrying an opening, a panel ruling or a platform ending; a completed Round still waiting; a recovery bound on a completed Round; a capture shortfall with an outcome',
      should: 'refuse each',
      actual: [
        parses({ ...view, opening: opening.opening }),
        parses({ ...view, panelRuling: 'transcript-incomplete' }),
        parses({ ...view, platformEnding: 'recovery_bound' }),
        parses({ ...completed, waitingOn }),
        parses({ ...completed, platformEnding: 'recovery_bound' }),
        parses({
          ...completed,
          outcome: { kind: 'winner', side: 'affirmative' },
          platformEnding: 'capture_shortfall',
        }),
      ],
      expected: [false, false, false, false, false, false],
    });
  });

  test('judge anonymity in the contract', () => {
    assert({
      given:
        'a host actor, an anonymous judge carrying a name, and a named judge seat',
      should:
        'refuse the host actor and a named anonymous seat, and accept a named judge for the viewers allowed to see it',
      actual: [
        parses({ ...view, hostActorId: id('h') }),
        parses({
          ...view,
          participants: [debater, { ...anonymousJudge, label: 'Riley' }],
        }),
        parses({
          ...view,
          participants: [
            debater,
            {
              ...debater,
              id: id('j'),
              seat: { kind: 'judge', slot: 0 },
              label: 'Riley',
            },
          ],
        }),
        view.participants.filter(isNamedSeat).map((p) => p.label),
      ],
      expected: [false, false, true, ['Sam Reyes']],
    });
  });
});
