import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, isNamedSeat, roundViewSchema } from './index';
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
});
const debater = {
  id: id('p'),
  actorId: id('q'),
  kind: 'human',
  label: 'Sam Reyes',
  role: 'affirmative',
  slot: 0,
} as const;
const anonymousJudge = {
  role: 'judge',
  kind: 'human',
  slot: 0,
  anonymous: true,
} as const;
const view = {
  id: id('r'),
  roomId: id('m'),
  version: 3,
  status: 'active',
  competitionType: 'ranked',
  topic: 'A topic',
  visibility: 'public',
  config: plainRoomConfig,
  rules,
  participants: [debater, anonymousJudge],
  startedAt: at(0),
  completedAt: null,
  outcome: null,
  unjudgedRuling: null,
  viewerIsHost: false,
  checkpoint: emptyRuntimeCheckpoint,
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
          unjudgedRuling: 'transcript-incomplete',
        }),
        parses({ ...view, unjudgedRuling: 'media-failed' }),
        parses((({ unjudgedRuling: _u, ...rest }) => rest)(view)),
      ],
      expected: [true, false, false],
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
            { ...debater, id: id('j'), role: 'judge', label: 'Riley' },
          ],
        }),
        view.participants.filter(isNamedSeat).map((p) => p.label),
      ],
      expected: [false, false, true, ['Sam Reyes']],
    });
  });
});
