import { assert, setupRitewayBun, test } from 'riteway/bun';
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
    given: 'a scheduled Round read by its host and by a seated non-host',
    should: 'offer the host-only start intent to the host alone',
    actual: [true, false].map((viewerIsHost) =>
      roundControlIntents(
        { ...view, viewerIsHost },
        aff.actorId,
        Date.parse(at(0)),
      ).map((c) => c.type),
    ),
    expected: [['start'], []],
  });
  const prepping = {
    ...ran(0),
    checkpoint: {
      ...ran(0).checkpoint!,
      active_prep: { side: 'affirmative' as const, started_at: at(1000) },
    },
  };
  assert({
    given: 'the affirmative running prep before its speech',
    should: 'offer one Start intent and no separate save-the-rest command',
    actual: roundControlIntents(
      prepping,
      aff.actorId,
      Date.parse(at(2000)),
    ).map((c) => c.type),
    expected: ['start_speech', 'forfeit'],
  });
  const active = ran(1);
  assert({
    given: 'an own speech with permitted early yield',
    should: 'offer a confirmed server yield',
    actual: roundControlIntents(
      active,
      aff.actorId,
      Date.parse(at(startOf(0) + 1000)),
    ).find((c) => c.type === 'yield')?.confirm,
    expected: true,
  });
  const cx = ran(2);
  const controls = roundControlIntents(
    cx,
    aff.actorId,
    Date.parse(at(startOf(1) + 1000)),
  );
  assert({
    given: 'the responder during ordered CX',
    should: 'offer interruption without claiming floor-holder yield',
    actual: controls
      .filter((c) => c.enabled && c.type !== 'forfeit')
      .map((c) => c.type),
    expected: ['interrupt'],
  });
  assert({
    given: 'a bot actor represented in the viewer projection',
    should: 'never create human control intents for that service seat',
    actual: roundControlIntents(
      cx,
      neg.actorId,
      Date.parse(at(startOf(1) + 1000)),
    ),
    expected: [],
  });
});

test('between segments, prep is offered only before an own speech while prep is still spendable', () => {
  const between = ran(4);
  const now = Date.parse(
    at(startOf(3) + between.rules.segments[3]!.durationMs + 1),
  );
  const prep = between.rules.inRoundPrep!;
  const intents = (inRoundPrep: typeof prep | null) =>
    roundControlIntents(
      { ...between, rules: { ...between.rules, inRoundPrep } },
      aff.actorId,
      now,
    ).map((c) => c.type);
  assert({
    given:
      'the gap before the affirmative 1AR with prep, prep expiring at 1AR, prep expiring at 2AR, and no in-round prep',
    should: 'offer prep only while it can still be spent before 1AR',
    actual: [
      intents(prep),
      intents({ ...prep, expiresAtSegment: '1AR' }),
      intents({ ...prep, expiresAtSegment: '2AR' }),
      intents(null),
    ],
    expected: [
      ['start_prep', 'forfeit'],
      ['forfeit'],
      ['start_prep', 'forfeit'],
      ['forfeit'],
    ],
  });
});

test('control labels name speeches and prep in words, never by code', () => {
  const prepping = {
    ...ran(0),
    checkpoint: {
      ...ran(0).checkpoint!,
      active_prep: { side: 'affirmative' as const, started_at: at(1000) },
    },
  };
  const between = ran(4);
  const label = (
    intents: ReturnType<typeof roundControlIntents>,
    type: string,
  ) => intents.find((c) => c.type === type)?.label;
  assert({
    given:
      'prep before the next own speech, then the gap where prep can be taken',
    should: 'start the speech by its lowercased full name and offer prep time',
    actual: [
      label(
        roundControlIntents(prepping, aff.actorId, Date.parse(at(2000))),
        'start_speech',
      ),
      label(
        roundControlIntents(
          between,
          aff.actorId,
          Date.parse(
            at(startOf(3) + between.rules.segments[3]!.durationMs + 1),
          ),
        ),
        'start_prep',
      ),
    ],
    expected: ['Start affirmative constructive', 'Take prep time'],
  });
});
