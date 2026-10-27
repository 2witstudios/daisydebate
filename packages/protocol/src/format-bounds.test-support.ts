import type { FormatDefinition } from './index';
import { oneOnOneFormatFixture } from './format-fixtures.test-support';

/** The one-on-one fixture with part of its capabilities replaced. */
function withConfigurable(
  patch: Partial<FormatDefinition['configurable']>,
): FormatDefinition {
  return {
    ...oneOnOneFormatFixture,
    configurable: { ...oneOnOneFormatFixture.configurable, ...patch },
  };
}
function withInteraction(
  patch: Partial<FormatDefinition['configurable']['interaction']>,
): FormatDefinition {
  return withConfigurable({
    interaction: {
      ...oneOnOneFormatFixture.configurable.interaction,
      ...patch,
    },
  });
}

/** `count` alternating speeches with consistent timing bounds, to probe MAX_FORMAT_SEGMENTS alone. */
export function formatWithSegments(count: number): FormatDefinition {
  const segments = Array.from({ length: count }, (_, index) => ({
    key: `S${index}`,
    label: `Speech ${index + 1}`,
    type: 'speech' as const,
    side: index % 2 === 0 ? ('affirmative' as const) : ('negative' as const),
    slot: 0,
    defaultDurationMs: 60_000,
  }));
  const bounds = { min: 60_000, max: 60_000 };
  return {
    ...withConfigurable({
      timing: {
        ...oneOnOneFormatFixture.configurable.timing,
        segmentDurationMs: Object.fromEntries(
          segments.map((segment) => [segment.key, bounds]),
        ),
      },
    }),
    segments,
  };
}

/** DEC-131: formats over MAX_FORMAT_SEGMENTS or with repeated options, refused at both boundaries. */
export const unboundedFormatDefinitions: ReadonlyArray<
  readonly [string, FormatDefinition]
> = [
  ['more than 64 segments', formatWithSegments(65)],
  [
    'duplicate cross-ex modes',
    withInteraction({ crossExModes: ['ordered', 'ordered'] }),
  ],
  [
    'duplicate interruption modes',
    withInteraction({
      interruptions: {
        modes: ['enabled', 'enabled'],
        minRemainingMs: { min: 0, max: 0 },
      },
    }),
  ],
  [
    'duplicate yield choices',
    withInteraction({
      yield: { enabledChoices: [true, true], returnsTimeChoices: [false] },
    }),
  ],
  [
    'duplicate prep segment types',
    withConfigurable({
      inRoundPrep: {
        budgetMsPerSide: { min: 0, max: 600_000 },
        spendableBefore: ['speech', 'speech'],
        expiresAtSegment: null,
      },
    }),
  ],
];
