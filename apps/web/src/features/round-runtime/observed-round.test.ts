import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, type RoundView } from '@daisy/protocol';
import {
  at,
  countdown,
  neg,
  origin,
  ran,
  rules,
  startOf,
  view,
} from '../../ui/debate-room/live-round.test-support';
import { observedRoundOf } from './observed-round';

setupRitewayBun();

describe('observedRoundOf', () => {
  test('the seats', () => {
    const watched = observedRoundOf(ran(1), origin + startOf(0) + 60_000);
    assert({
      given: 'the affirmative constructive a minute in',
      should:
        'name both debaters by side, the affirmative speaking and the negative listening, with no judge identity',
      actual: watched.seats,
      expected: [
        {
          side: 'affirmative',
          label: 'Sam Reyes',
          bot: false,
          activity: 'speaking',
        },
        {
          side: 'negative',
          label: neg.label,
          bot: true,
          activity: 'listening',
        },
      ],
    });
  });

  test('a speech', () => {
    const watched = observedRoundOf(ran(1), origin + startOf(0) + 60_000);
    assert({
      given: 'the affirmative constructive a minute in',
      should:
        'be in a speech on its clock, with it now, the next one next and the rest upcoming',
      actual: [
        watched.stage,
        watched.clock,
        watched.speeches.slice(0, 3).map((speech) => speech.state),
        watched.judge,
      ],
      expected: [
        'speech',
        {
          label: `${rules[0]!.key} · ${rules[0]!.label}`,
          remainingMs: rules[0]!.durationMs - 60_000,
        },
        ['now', 'next', 'upcoming'],
        'human',
      ],
    });
  });

  test('the countdown', () => {
    const watched = observedRoundOf(ran(0), origin + 4_000);
    assert({
      given: 'a started round 4 seconds into its countdown',
      should: 'count down to the first speech, which is next',
      actual: [watched.stage, watched.clock, watched.speeches[0]?.state],
      expected: [
        'countdown',
        { label: 'Starts in', remainingMs: countdown - 4_000 },
        'next',
      ],
    });
  });

  test('cross-examination', () => {
    const watched = observedRoundOf(ran(2), origin + startOf(1) + 30_000);
    assert({
      given: 'the negative’s cross-examination half a minute in',
      should: 'name who asks and who answers, and mark the first speech done',
      actual: [
        watched.stage,
        watched.clock?.label,
        watched.seats.map((seat) => seat.activity),
        watched.speeches[0]?.state,
      ],
      expected: [
        'cross-ex',
        'Cross-examination · Negative asks',
        ['answering', 'asking'],
        'done',
      ],
    });
  });

  test('prep', () => {
    const prepping: RoundView = {
      ...ran(4, true),
      checkpoint: {
        ...emptyRuntimeCheckpoint,
        active_prep: { side: 'affirmative', started_at: at(startOf(4)) },
      },
    };
    const watched = observedRoundOf(prepping, origin + startOf(4) + 20_000);
    assert({
      given: 'the affirmative 20 seconds into prep before the 1AR',
      should:
        'show Affirmative prep, the affirmative preparing and the 1AR next',
      actual: [
        watched.stage,
        watched.clock?.label,
        watched.seats.map((seat) => seat.activity),
        watched.speeches[4]?.state,
      ],
      expected: ['prep', 'Affirmative prep', ['preparing', 'waiting'], 'next'],
    });
  });

  test('before the round starts, and an unreadable checkpoint', () => {
    assert({
      given: 'a new round, then an active one whose checkpoint is unreadable',
      should: 'show it starting with no clock, then waiting with nothing lit',
      actual: [
        [
          observedRoundOf(view, origin).stage,
          observedRoundOf(view, origin).clock,
        ],
        [
          observedRoundOf({ ...ran(1), checkpoint: null }, origin).stage,
          observedRoundOf({ ...ran(1), checkpoint: null }, origin).clock,
          observedRoundOf(
            { ...ran(1), checkpoint: null },
            origin,
          ).speeches.some((speech) => speech.state !== 'upcoming'),
        ],
      ],
      expected: [
        ['starting', null],
        ['between', null, false],
      ],
    });
  });

  test('after the last speech', () => {
    const watched = observedRoundOf(
      ran(rules.length, true),
      origin + startOf(rules.length) + 10_000,
    );
    assert({
      given: 'every speech closed and the judge deciding',
      should: 'be judging, every speech done, no clock',
      actual: [
        watched.stage,
        watched.clock,
        watched.speeches.every((speech) => speech.state === 'done'),
      ],
      expected: ['judging', null, true],
    });
  });
});

describe('observedRoundOf, the opening and the judging window', () => {
  const opening = (
    step: NonNullable<RoundView['opening']>['step'],
  ): RoundView => ({
    ...view,
    status: 'opening',
    opening: { step, draw: null, canStrike: false },
  });

  test('the strike and the prep before the round', () => {
    const striking = observedRoundOf(opening({ step: 'strike' }), origin);
    const prepping = observedRoundOf(
      opening({
        step: 'prep',
        startedAt: at(0),
        endsAt: at(20 * 60_000),
        remainingMs: 20 * 60_000,
      }),
      origin + 60_000,
    );
    assert({
      given: 'an opening at its strike, then 1 minute into its 20-minute prep',
      should:
        'be striking with no clock, then count the prep down with both sides preparing and the first speech next',
      actual: [
        [striking.stage, striking.clock, striking.speeches[0]?.state],
        [
          prepping.stage,
          prepping.clock,
          prepping.seats.map((seat) => seat.activity),
          prepping.speeches[0]?.state,
          prepping.prepMs,
        ],
      ],
      expected: [
        ['strike', null, 'next'],
        [
          'opening-prep',
          { label: 'Prep before the round', remainingMs: 19 * 60_000 },
          ['preparing', 'preparing'],
          'next',
          null,
        ],
      ],
    });
  });

  test('the speech kinds and each side’s prep left', () => {
    const watched = observedRoundOf(ran(1), origin + startOf(0) + 60_000);
    assert({
      given: 'a running Round',
      should:
        'mark cross-examinations apart from speeches and keep both sides’ prep left',
      actual: [
        watched.speeches.map((speech) => speech.kind),
        watched.prepMs === null ? null : Object.keys(watched.prepMs).sort(),
      ],
      expected: [
        rules.map((segment) =>
          segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
        ),
        view.rules.inRoundPrep ? ['affirmative', 'negative'] : null,
      ],
    });
  });

  test('the judging window', () => {
    const closed = ran(rules.length, true);
    const watched = observedRoundOf(
      {
        ...closed,
        waitingOn: {
          state: 'human_window',
          deadlineAt: at(startOf(rules.length) + 30 * 60_000),
        },
      },
      origin + startOf(rules.length) + 60_000,
    );
    assert({
      given: 'the speeches over and a human judge’s window open a minute',
      should: 'count the window down to its persisted deadline',
      actual: [watched.stage, watched.clock],
      expected: [
        'judging',
        { label: 'Judging window', remainingMs: 29 * 60_000 },
      ],
    });
  });
});
