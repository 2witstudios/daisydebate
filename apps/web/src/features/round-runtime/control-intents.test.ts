import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol/round-view';
import { roundControlIntents } from './control-intents';
import {
  view,
  aff,
  neg,
  ran,
  at,
  startOf,
} from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();
test('Round controls follow existing runtime position and preserve floor command ownership', () => {
  assert({
    given: 'an opening Round read by its host and by a seated non-host',
    should: 'offer neither a start intent: the opening runs on its own',
    actual: [true, false].map((viewerIsHost) =>
      roundControlIntents(
        { ...view, viewerIsHost },
        aff.actorId,
        instantMs(at(0)),
      ).map((c) => c.type),
    ),
    expected: [[], []],
  });
  const prepping = {
    ...ran(0),
    checkpoint: {
      ...ran(0).checkpoint!,
      prep: {
        phase: 'running' as const,
        side: 'affirmative' as const,
        started_at: at(1000),
      },
    },
  };
  assert({
    given: 'the affirmative running prep before its speech',
    should: 'offer one Start intent and no separate save-the-rest command',
    actual: roundControlIntents(prepping, aff.actorId, instantMs(at(2000))).map(
      (c) => c.type,
    ),
    expected: ['start_speech', 'forfeit'],
  });
  const active = ran(1);
  assert({
    given: 'an own speech with permitted early yield',
    should: 'offer a confirmed server yield',
    actual: roundControlIntents(
      active,
      aff.actorId,
      instantMs(at(startOf(0) + 1000)),
    ).find((c) => c.type === 'yield')?.confirm,
    expected: true,
  });
  const cx = ran(2);
  const controls = roundControlIntents(
    cx,
    aff.actorId,
    instantMs(at(startOf(1) + 1000)),
  );
  assert({
    given: 'the person answering a bot’s cross-examination',
    should:
      'offer only a confirmed end to it, since a bot asker cannot end it (INTX-9), and no point of information',
    actual: controls
      .filter((c) => c.enabled && c.type !== 'forfeit')
      .map((c) => [c.type, c.label, c.confirm]),
    expected: [['yield', 'End cross-examination', true]],
  });
  assert({
    given: 'a bot actor represented in the viewer projection',
    should: 'never create human control intents for that service seat',
    actual: roundControlIntents(
      cx,
      neg.actorId,
      instantMs(at(startOf(1) + 1000)),
    ),
    expected: [],
  });
});

test('between segments, prep is offered only before an own speech while prep is still spendable', () => {
  const between = ran(4);
  const now = instantMs(
    at(startOf(3) + between.rules.segments[3]!.durationMs + 1),
  );
  const prep = between.rules.inRoundPrep!;
  const intents = (inRoundPrep: typeof prep | null) =>
    roundControlIntents(
      { ...between, rules: { ...between.rules, inRoundPrep } },
      aff.actorId,
      now,
    ).map((c) => (c.type === 'start_prep' ? c.label : c.type));
  assert({
    given:
      'the gap before the affirmative 1AR with prep, prep expiring at 1AR, prep expiring at 2AR, and no in-round prep',
    should:
      'offer prep while it can still be spent before 1AR, and say so once it has ended',
    actual: [
      intents(prep),
      intents({ ...prep, expiresAtSegment: '1AR' }),
      intents({ ...prep, expiresAtSegment: '2AR' }),
      intents(null),
    ],
    expected: [
      ['Take prep time', 'forfeit'],
      ['Prep has ended', 'forfeit'],
      ['Take prep time', 'forfeit'],
      ['forfeit'],
    ],
  });
});

test('control labels name speeches and prep in words, never by code', () => {
  const prepping = {
    ...ran(0),
    checkpoint: {
      ...ran(0).checkpoint!,
      prep: {
        phase: 'running' as const,
        side: 'affirmative' as const,
        started_at: at(1000),
      },
    },
  };
  const between = ran(4);
  const label = (
    intents: ReturnType<typeof roundControlIntents>,
    type: string,
  ) => {
    const found = intents.find((c) => c.type === type);
    return [found?.label, found?.hint];
  };
  assert({
    given:
      'prep before the next own speech, then the gap where prep can be taken',
    should:
      'start the speech by its lowercased full name and offer prep time before the next speech by name',
    actual: [
      label(
        roundControlIntents(prepping, aff.actorId, instantMs(at(2000))),
        'start_speech',
      ),
      label(
        roundControlIntents(
          between,
          aff.actorId,
          instantMs(at(startOf(3) + between.rules.segments[3]!.durationMs + 1)),
        ),
        'start_prep',
      ),
    ],
    expected: [
      [
        'Start affirmative constructive',
        'Ends prep; unused prep stays your side’s',
      ],
      ['Take prep time', 'Before the first affirmative rebuttal'],
    ],
  });
});

test('controls act only once the persisted Round reaches the phase the clock shows (ISSUE-838)', () => {
  const opened = instantMs(at(startOf(0) + 100));
  const enabled = (round: RoundView) =>
    roundControlIntents(round, aff.actorId, opened)
      .filter((c) => c.enabled)
      .map((c) => c.type);
  const expired = instantMs(at(startOf(1) + 100));
  assert({
    given:
      'a speech the clock has opened but the server has not yet persisted, the same once persisted, and a persisted speech the clock has already closed',
    should:
      'disable every control until the persisted phase agrees, so no command carries a version the server will refuse as stale',
    actual: [
      enabled(ran(0)),
      enabled(ran(1)),
      roundControlIntents(ran(1), aff.actorId, expired).filter((c) => c.enabled)
        .length,
    ],
    expected: [[], ['yield', 'forfeit'], 0],
  });
});
