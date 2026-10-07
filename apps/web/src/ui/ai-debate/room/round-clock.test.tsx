import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { sampleBots } from '../../../ui/mock/train-bots';
import type {
  AiDebateView,
  UiState,
} from '../../../features/ai-debate/context';
import { RoundClock } from './round-clock';
import { Stage } from './stage';

setupRitewayBun();

const resolved = resolveRoomConfiguration(
  oneOnOneDefinition,
  practiceRoomConfig,
);
if (!resolved.ok) throw new Error(resolved.refusal.message);

const view: AiDebateView = {
  id: 'c8d4e2f6a1b3k5m7n9p2r4t6',
  resolution: 'A representative resolution',
  personSide: 'affirmative',
  opponent: 'wren',
  voice: 'aura-2-thalia-en',
  serverNow: 0,
  version: 1,
  status: 'active',
  startedAt: 0,
  rules: resolved.rules,
  segments: [],
  checkpoint: {
    version: 1,
    prep_consumed_ms: { affirmative: 0, negative: 0 },
    active_prep: null,
    floor: null,
  },
  utterances: [],
  ballot: null,
};

const clock = (state: UiState) =>
  renderToString(
    h(RoundClock, { state, view, personSide: 'affirmative' }),
  ).replaceAll('<!-- -->', '');

describe('RoundClock', () => {
  test('reads the moment', () => {
    assert({
      given: 'the countdown into the AC with the person affirmative',
      should: 'count seconds until they speak',
      actual: ((html) =>
        html.includes('until you speak</span>') && html.includes('>7</span>'))(
        clock({ phase: 'countdown', segmentIndex: 0, remainingMs: 7_000 }),
      ),
      expected: true,
    });
    assert({
      given: 'the last ten seconds of prep',
      should: 'count down to the speech',
      actual: clock({
        phase: 'prep',
        segmentIndex: 4,
        remainingMs: 9_000,
      }).includes('until your speech starts'),
      expected: true,
    });
  });

  test('warms at a minute and turns urgent at thirty seconds', () => {
    assert({
      given: 'a speech with 0:59, then 0:29, then 2:00 left',
      should: 'show it gold, then red, then plain',
      actual: [59_000, 29_000, 120_000].map((left) => {
        const html = clock({
          phase: 'live',
          segmentIndex: 0,
          remainingMs: left,
        });
        return html.includes('text-live')
          ? 'urgent'
          : html.includes('text-gold')
            ? 'warm'
            : 'calm';
      }),
      expected: ['warm', 'urgent', 'calm'],
    });
  });

  test('no clock runs before it starts or after the debate', () => {
    assert({
      given: 'waiting, ended and aborted states',
      should: 'render nothing',
      actual: [
        clock({ phase: 'waiting' }),
        clock({ phase: 'ended' }),
        clock({ phase: 'aborted' }),
      ].map((html) => html.includes('role="timer"')),
      expected: [false, false, false],
    });
  });
});

const bot = sampleBots.find((candidate) => candidate.id === 'wren')!;

describe('Stage', () => {
  test('outlines whoever holds the floor, and shows your microphone only when it is open', () => {
    const render = (state: UiState, listening: boolean) =>
      renderToString(
        h(Stage, {
          bot,
          personSide: 'affirmative',
          view,
          state,
          speaking: false,
          level: 0.2,
          listening,
        }),
      ).replaceAll('<!-- -->', '');
    const live = (segmentIndex: number) =>
      ({ phase: 'live', segmentIndex, remainingMs: 30_000 }) as const;
    assert({
      given: 'the person speaking live with the microphone open',
      should: 'outline them and show the meter',
      actual: [
        render(live(0), true).includes('aria-current="true"'),
        render(live(0), true).includes('transition-opacity h-2 opacity-100'),
        render(live(0), true).includes('aria-hidden="true"'),
      ],
      expected: [true, true, true],
    });
    assert({
      given: 'the opponent speaking live with the microphone closed',
      should: 'outline the opponent and show no meter',
      actual: [
        render(live(2), false).includes('aria-current="true"'),
        render(live(2), false).includes('opacity-100'),
      ],
      expected: [true, false],
    });
    assert({
      given: 'the microphone closed',
      should: 'show no meter even on the floor',
      actual: render(live(0), false).includes('opacity-100'),
      expected: false,
    });
  });
});
