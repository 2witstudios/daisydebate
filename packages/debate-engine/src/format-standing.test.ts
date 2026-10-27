import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  FormatChange,
  FormatDefinition,
  RoomConfig,
} from '@daisy/protocol';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { oneOnOneConfig } from './runtime.test-support';
import { formatStanding, type StandingBasis } from './format-standing';
import { drawRoom } from './room-pre-round.test-support';

setupRitewayBun();

const basis = (overrides: Partial<StandingBasis> = {}): StandingBasis => ({
  formatId: 'value',
  presetVersion: 3,
  formatVersion: 1,
  role: 'standard',
  definition: oneOnOneFormatFixture,
  config: oneOnOneConfig,
  ...overrides,
});

const active = (
  config: RoomConfig = oneOnOneConfig,
  overrides: {
    readonly formatId?: string;
    readonly formatVersion?: number;
    readonly definition?: FormatDefinition;
  } = {},
) => ({
  formatId: 'value',
  formatVersion: 1,
  definition: oneOnOneFormatFixture,
  config,
  ...overrides,
});

const withTiming = (
  overrides: Record<string, number>,
  countdownMs = oneOnOneConfig.speechTiming.countdownMs,
): RoomConfig => ({
  ...oneOnOneConfig,
  speechTiming: { countdownMs, segmentDurationOverrides: overrides },
});

const firstSegment = oneOnOneFormatFixture.segments[0]!;

/** The fixture definition without one segment and its timing bound. */
const withoutSegment = (key: string): FormatDefinition => ({
  ...oneOnOneFormatFixture,
  segments: oneOnOneFormatFixture.segments.filter((s) => s.key !== key),
  configurable: {
    ...oneOnOneFormatFixture.configurable,
    timing: {
      ...oneOnOneFormatFixture.configurable.timing,
      segmentDurationMs: Object.fromEntries(
        Object.entries(
          oneOnOneFormatFixture.configurable.timing.segmentDurationMs,
        ).filter(([bound]) => bound !== key),
      ),
    },
  },
});

/** A private custom definition's standing against the Value basis. */
const customStanding = (definition: FormatDefinition) =>
  formatStanding({
    active: active(oneOnOneConfig, { formatId: 'private-format', definition }),
    basis: basis(),
  });

describe('formatStanding', () => {
  test('standard', () => {
    assert({
      given: 'a room still running its standard basis unchanged',
      should: 'be Standard',
      actual: formatStanding({ active: active(), basis: basis() }),
      expected: { kind: 'standard', formatId: 'value' },
    });
    assert({
      given:
        'an explicit override equal to the default, and a change reverted by hand',
      should: 'still be Standard: equality is over the compiled rules',
      actual: formatStanding({
        active: active(
          withTiming({ [firstSegment.key]: firstSegment.defaultDurationMs }),
        ),
        basis: basis(),
      }).kind,
      expected: 'standard',
    });
  });

  test('custom', () => {
    assert({
      given: 'a standard room with a shorter speech and more prep',
      should: 'be Custom, based on the standard, listing each change',
      actual: formatStanding({
        active: active({
          ...withTiming({ [firstSegment.key]: 240_000 }),
          inRoundPrep: { enabled: true, budgetMsPerSide: 300_000 },
        }),
        basis: basis(),
      }),
      expected: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [
          {
            kind: 'segment-duration',
            key: firstSegment.key,
            fromMs: firstSegment.defaultDurationMs,
            toMs: 240_000,
          },
          {
            kind: 'in-round-prep',
            fromMs: oneOnOneConfig.inRoundPrep.enabled
              ? oneOnOneConfig.inRoundPrep.budgetMsPerSide
              : null,
            toMs: 300_000,
          },
        ],
      },
    });
    assert({
      given: 'prep before the round switched on, and a different countdown',
      should: 'list both changes, including the room plan’s pre-round prep',
      actual: formatStanding({
        active: active({
          ...withTiming({}, 0),
          preRoundPrep: { enabled: true, durationMs: 600_000 },
        }),
        basis: basis(),
      }),
      expected: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [
          {
            kind: 'countdown',
            fromMs: oneOnOneConfig.speechTiming.countdownMs,
            toMs: 0,
          },
          { kind: 'pre-round-prep', fromMs: null, toMs: 600_000 },
        ],
      },
    });
  });

  test('templates and identity', () => {
    assert({
      given: 'an unchanged league template',
      should: 'be Custom with no changes: only standards are Standard',
      actual: formatStanding({
        active: active(oneOnOneConfig, { formatId: 'nsda-ld' }),
        basis: basis({ formatId: 'nsda-ld', role: 'template' }),
      }),
      expected: {
        kind: 'custom',
        basis: { formatId: 'nsda-ld', role: 'template' },
        changes: [],
      },
    });
    assert({
      given:
        'a private custom definition that compiles exactly like its standard basis',
      should:
        'be Custom because its identity differs, without claiming a speech or seat change',
      actual: formatStanding({
        active: active(oneOnOneConfig, {
          formatId: 'private-format',
          formatVersion: 1,
        }),
        basis: basis(),
      }),
      expected: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [],
      },
    });
    assert({
      given: 'a room with no basis',
      should: 'be plain Custom',
      actual: formatStanding({ active: active(), basis: null }),
      expected: { kind: 'custom', basis: null, changes: [] },
    });
  });

  test('definition changes', () => {
    const removed = oneOnOneFormatFixture.segments.at(-1)!.key;
    const definition: FormatDefinition = {
      ...withoutSegment(removed),
      seats: { ...oneOnOneFormatFixture.seats, judge: 3 },
    };
    assert({
      given: 'a custom definition with a judge panel and one speech dropped',
      should: 'name the seat and speech changes',
      actual: customStanding(definition),
      expected: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [
          {
            kind: 'seats',
            role: 'judge',
            from: oneOnOneFormatFixture.seats.judge,
            to: 3,
          },
          { kind: 'segments', added: [], removed: [removed], changed: [] },
        ],
      },
    });
  });

  test('resolution strike changes', () => {
    const drawn = drawRoom({ kind: 'bank', categories: ['policy', 'value'] });
    const strikeBasis = basis({
      formatId: 'freestyle',
      definition: drawn.definition,
      config: drawn.config,
    });
    const strikeActive = (config: RoomConfig) =>
      active(config, { formatId: 'freestyle', definition: drawn.definition });
    const frozen: FormatChange & { kind: 'resolution-draw' } extends {
      from: infer F;
    }
      ? F
      : never = {
      enabled: true,
      drawSize: 5,
      strikeWindowMs: 60_000,
      firstStriker: 'negative',
      source: { kind: 'bank', categories: ['policy', 'value'] },
    };
    assert({
      given: 'a striking standard whose host turned the strike off',
      should: 'list the strike change in the public frozen shape',
      actual: formatStanding({
        active: strikeActive({
          ...drawn.config,
          resolutionDraw: { enabled: false },
        }),
        basis: strikeBasis,
      }),
      expected: {
        kind: 'custom',
        basis: { formatId: 'freestyle', role: 'standard' },
        changes: [
          { kind: 'resolution-draw', from: frozen, to: { enabled: false } },
        ],
      },
    });
  });

  test('a removed middle speech changes only itself (PR #472 review)', () => {
    const middle = oneOnOneFormatFixture.segments[1]!.key;
    assert({
      given: 'a custom definition without its second segment',
      should: 'list it as removed and every kept segment as unchanged',
      actual: customStanding(withoutSegment(middle)),
      expected: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [
          { kind: 'segments', added: [], removed: [middle], changed: [] },
        ],
      },
    });
  });
});
