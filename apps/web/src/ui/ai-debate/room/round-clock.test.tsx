import type { AiDebateState } from '@daisy/debate-engine';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { botSelector } from '../../../features/train/bots';
import { RoundClock } from './round-clock';
import { Stage } from './stage';

setupRitewayBun();

const T = Date.UTC(2026, 9, 3, 18, 0, 0);
const clock = (state: AiDebateState) =>
  renderToString(
    h(RoundClock, { state, personSide: 'affirmative', opponent: 'Wren' }),
  ).replaceAll('<!-- -->', '');
const live = (turnIndex: number, remainingMs: number, lengthMs: number) =>
  ({
    phase: 'live',
    turnIndex,
    startedAt: T,
    endsAt: T + lengthMs,
    remainingMs,
    prepLeftMs: 240_000,
  }) as const;

describe('RoundClock', () => {
  test('each turn is as wide as it is long', () => {
    const html = clock(live(0, 60_000, 300_000));
    assert({
      given: 'the seven turns of 5, 2, 6, 2, 5, 5 and 3 minutes',
      should: 'give each its own grow factor in order',
      actual: [...html.matchAll(/basis-0 flex-col gap-1 (grow(?:-\d)?)/g)].map(
        (match) => match[1],
      ),
      expected: [
        'grow-5',
        'grow-2',
        'grow-6',
        'grow-2',
        'grow-5',
        'grow-5',
        'grow-3',
      ],
    });
  });

  test('reads the moment', () => {
    assert({
      given: 'the countdown into the AC with the person affirmative',
      should: 'count seconds until they speak',
      actual: clock({
        phase: 'countdown',
        turnIndex: 0,
        startsAt: T + 7_000,
        remainingMs: 7_000,
        prepLeftMs: 240_000,
      }).includes('>7</span><span class="text-ink-muted">until you speak<'),
      expected: true,
    });
    assert({
      given: 'the last ten seconds of prep',
      should: 'count down to the speech',
      actual: clock({
        phase: 'prep',
        turnIndex: 4,
        prepStartedAt: T,
        prepLeftMs: 9_000,
      }).includes('until your speech starts'),
      expected: true,
    });
  });

  test('warms at a minute and turns urgent at thirty seconds', () => {
    assert({
      given: 'a speech with 0:59, then 0:29, then 2:00 left',
      should: 'show it gold, then red, then plain',
      actual: [59_000, 29_000, 120_000].map((left) => {
        const html = clock(live(0, left, 300_000));
        return ['text-gold', 'text-live', 'text-ink tabular'].find((tone) =>
          html.includes(tone),
        );
      }),
      expected: ['text-gold', 'text-live', undefined],
    });
  });

  test('a timer that is not announced, over a timeline of every turn', () => {
    const html = clock(live(1, 60_000, 120_000));
    assert({
      given: 'the first CX half done',
      should:
        'mark the clock as a timer, fill earlier turns and half of this one, and name the opponent',
      actual: {
        timer: html.includes('role="timer"'),
        turns: html.match(/<progress/g)?.length,
        acDone: html.includes(
          'value="100" aria-label="Affirmative constructive',
        ),
        cxHalf: html.includes(
          'value="50" aria-label="Cross-examination of the affirmative',
        ),
        legend: html.includes('</span> Wren</span>'),
      },
      expected: {
        timer: true,
        turns: 7,
        acDone: true,
        cxHalf: true,
        legend: true,
      },
    });
  });
});

describe('Stage', () => {
  const stage = (state: AiDebateState, listening: boolean) =>
    renderToString(
      h(Stage, {
        bot: botSelector('wren').selected,
        personSide: 'affirmative',
        state,
        speaking: false,
        level: 0.05,
        listening,
      }),
    );

  test('outlines whoever holds the floor, and shows your microphone only when it is open', () => {
    const yours = stage(live(0, 200_000, 300_000), true);
    const theirs = stage(live(2, 200_000, 360_000), false);
    assert({
      given: "the person's AC with the microphone open, then Wren's NC",
      should:
        'outline the person, then Wren, and show the meter only while listening',
      actual: [
        yours.indexOf('aria-current="true"') > yours.indexOf('Wren'),
        theirs.indexOf('aria-current="true"') < theirs.indexOf('You'),
        yours.includes('w-1 rounded-round'),
        theirs.includes('w-1 rounded-round'),
      ],
      expected: [true, true, true, false],
    });
  });
});
