import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
import {
  at,
  origin,
  ran,
  rules,
  startOf,
  view,
} from '../../ui/debate-room/live-round.test-support';
import { formatCountdown } from '../../lib/clock-display';
import { observedRoundOf } from '../round-runtime/observed-round';
import { judgeBallotDue, judgeRoomStageOf } from './judge-room-stage';

setupRitewayBun();

const facts: Parameters<typeof judgeRoomStageOf>[1] = {
  drawSize: 5,
  waitingOn: null,
};
const stageAt = (round: RoundView, nowMs: number, given = facts) =>
  judgeRoomStageOf(observedRoundOf(round, nowMs), given);
const name = (index: number) => `${rules[index]!.key} · ${rules[index]!.label}`;
const crossEx = rules.findIndex((segment) => segment.type === 'cross_ex');

describe('judgeRoomStageOf', () => {
  test('the opening', () => {
    const opening = (
      step: NonNullable<RoundView['opening']>['step'],
    ): RoundView => ({
      ...view,
      status: 'opening',
      opening: { step, draw: null, canStrike: false },
    });
    const strike = stageAt(opening({ step: 'strike' }), origin);
    const prep = stageAt(
      opening({
        step: 'prep',
        startedAt: at(0),
        endsAt: at(20 * 60_000),
        remainingMs: 20 * 60_000,
      }),
      origin,
    );
    assert({
      given: 'the strike from five drawn, then the prep before the round',
      should:
        'say what the strike is and that the judge sees the chosen one, then that the first speech starts on its own',
      actual: [strike.heading, strike.detail, prep.heading, prep.detail],
      expected: [
        'The debaters are choosing the resolution',
        'They take turns striking 5 drawn resolutions until one is left. You see the resolution once it is chosen.',
        'Prep before the round',
        `Both debaters are preparing. ${name(0)} starts on its own when prep ends.`,
      ],
    });
  });

  test('a speech and a cross-examination', () => {
    const speech = stageAt(ran(1), origin + startOf(0) + 1_000);
    const cx = stageAt(ran(crossEx + 1), origin + startOf(crossEx) + 1_000);
    const asker = rules[crossEx]!.side;
    assert({
      given: 'the first speech, then the first cross-examination',
      should:
        'name the speech, who speaks and what is next; then who asks and who answers',
      actual: [speech.heading, speech.detail, cx.heading, cx.detail],
      expected: [
        name(0),
        `Sam Reyes (Affirmative) is speaking. Next: ${name(1)}, ${formatCountdown(rules[1]!.durationMs)}.`,
        name(crossEx),
        `${asker === 'affirmative' ? 'Sam Reyes (Affirmative) asks; Practice bot (Negative) answers.' : 'Practice bot (Negative) asks; Sam Reyes (Affirmative) answers.'} Next: ${name(crossEx + 1)}, ${formatCountdown(rules[crossEx + 1]!.durationMs)}.`,
      ],
    });
  });

  test('each stage has its own key', () => {
    assert({
      given: 'two different speeches',
      should: 'give each its own key, so each is announced once',
      actual:
        stageAt(ran(1), origin + startOf(0) + 1_000).key ===
        stageAt(ran(3), origin + startOf(2) + 1_000).key,
      expected: false,
    });
  });

  test('the end of the speeches', () => {
    const closed = ran(rules.length, true);
    const nowMs = origin + startOf(rules.length) + 1_000;
    assert({
      given:
        'the transcript closing, attendance settling, then the window open',
      should: 'say where the ballot stands each time',
      actual: (
        ['closing_transcript', 'awaiting_attendance', 'human_window'] as const
      ).map(
        (state) =>
          stageAt(closed, nowMs, { drawSize: 5, waitingOn: state }).detail,
      ),
      expected: [
        'Your ballot opens in a moment, once the transcript is saved.',
        'Fill in your ballot now. Submitting opens once attendance for the last speeches is confirmed.',
        'Ballots are open until the judging window closes. Submit yours if you have not yet.',
      ],
    });
  });
});

describe('judgeRoomStageOf, between and after', () => {
  test('a countdown before a later speech names that speech', () => {
    const first = stageAt(ran(0), origin + 1_000);
    const between = stageAt(ran(1, true), origin + startOf(1) + 500);
    assert({
      given: 'the countdown before the first speech, then the one after it',
      should:
        'say Starting first, then name the speech coming up, each its own stage',
      actual: [
        [first.heading, first.detail],
        [between.heading, between.detail],
        first.key === between.key,
      ],
      expected: [
        ['Starting', `${name(0)} starts when the countdown ends.`],
        ['Between speeches', `${name(1)} starts when the countdown ends.`],
        false,
      ],
    });
  });

  test('each judging state is its own stage, and the ballot is due only before the result settles', () => {
    const closed = ran(rules.length, true);
    const nowMs = origin + startOf(rules.length) + 1_000;
    const keyOf = (waitingOn: Parameters<typeof judgeBallotDue>[0]) =>
      stageAt(closed, nowMs, { drawSize: 5, waitingOn }).key;
    assert({
      given:
        'the transcript closing, the window open, then the result settling',
      should:
        'change the key each time so the judge is told, and keep the ballot first only while it may be due',
      actual: [
        new Set([
          keyOf('closing_transcript'),
          keyOf('human_window'),
          keyOf('settling'),
        ]).size,
        stageAt(closed, nowMs, { drawSize: 5, waitingOn: 'settling' }).detail,
        [
          judgeBallotDue(null),
          judgeBallotDue('human_window'),
          judgeBallotDue('settling'),
          judgeBallotDue('ai_processing'),
        ],
      ],
      expected: [3, 'The result is being settled.', [true, true, false, false]],
    });
  });
});
