import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  oneOnOneFormatFixture,
  plainRoomConfig,
} from '@daisy/protocol/testing';
import { resolveRoomConfiguration } from './resolve-room-configuration';

setupRitewayBun();

const definition = {
  ...oneOnOneFormatFixture,
  configurable: {
    ...oneOnOneFormatFixture.configurable,
    resolutionDraw: {
      drawSize: { min: 3, max: 7 },
      strikeWindowMs: { min: 15_000, max: 180_000 },
      firstStrikers: ['negative' as const],
      sources: ['bank' as const],
    },
  },
};
const draw = {
  enabled: true as const,
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as 'negative' | 'affirmative',
  source: { kind: 'bank' as const, categories: ['value' as const] },
};
/** A config the fixture accepts apart from the draw. */
const base = {
  ...plainRoomConfig,
  interruptions: { mode: 'disabled' as const, minRemainingMs: 0 },
  yielding: { allowed: false, returnsTime: false },
};
const resolve = (choice: Partial<typeof draw> | { kind: 'host' }) =>
  resolveRoomConfiguration(definition, {
    ...base,
    resolutionDraw:
      'kind' in choice
        ? {
            ...draw,
            source: { kind: 'host', resolutions: ['A', 'B', 'C', 'D', 'E'] },
          }
        : { ...draw, ...choice },
  });
const kind = (outcome: ReturnType<typeof resolve>) =>
  outcome.ok ? 'ok' : outcome.refusal.kind;

describe('resolution draw resolution', () => {
  test('a draw within the format bounds joins the Room plan', () => {
    const outcome = resolve({});
    assert({
      given: 'a five-resolution bank draw the format permits',
      should: 'resolve it into the Room plan, never into the round rules',
      actual: outcome.ok && [
        outcome.roomPlan.resolutionDraw,
        'resolutionDraw' in outcome.rules,
      ],
      expected: [draw, false],
    });
  });

  test('choices outside the bounds or permitted sets are refused', () => {
    assert({
      given:
        'too many resolutions, too short a window, Affirmative first and a host list',
      should: 'refuse each with its named kind',
      actual: [
        kind(resolve({ drawSize: 8 })),
        kind(resolve({ strikeWindowMs: 10_000 })),
        kind(resolve({ firstStriker: 'affirmative' })),
        kind(resolve({ kind: 'host' })),
      ],
      expected: [
        'out-of-range',
        'out-of-range',
        'invalid-choice',
        'invalid-choice',
      ],
    });
  });

  test('a format without a draw forbids one', () => {
    assert({
      given: 'a draw on a definition whose draw capability is null',
      should: 'refuse it as forbidden',
      actual: kind(
        resolveRoomConfiguration(oneOnOneFormatFixture, {
          ...base,
          resolutionDraw: draw,
        }),
      ),
      expected: 'capability-forbidden',
    });
  });

  test('pre-round prep on a format that forbids it is refused', () => {
    assert({
      given:
        'enabled pre-round prep on a definition whose prep capability is null',
      should: 'refuse it as forbidden before the draw is considered',
      actual: kind(
        resolveRoomConfiguration(
          {
            ...definition,
            configurable: { ...definition.configurable, preRoundPrep: null },
          },
          {
            ...base,
            preRoundPrep: { enabled: true, durationMs: 60_000 },
            resolutionDraw: draw,
          },
        ),
      ),
      expected: 'capability-forbidden',
    });
    assert({
      given: 'pre-round prep longer than the format allows',
      should: 'refuse it as out of range',
      actual: kind(
        resolveRoomConfiguration(definition, {
          ...base,
          preRoundPrep: { enabled: true, durationMs: 1_200_001 },
          resolutionDraw: draw,
        }),
      ),
      expected: 'out-of-range',
    });
  });
});
