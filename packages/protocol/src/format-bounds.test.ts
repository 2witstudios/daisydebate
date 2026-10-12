import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  MAX_FORMAT_SEGMENTS,
  formatDefinitionSchema,
  roundRulesSchema,
  type FormatDefinition,
} from './format';
import { practiceFormatFixture } from './format-fixtures.test-support';

setupRitewayBun();

const withSegments = (count: number): FormatDefinition => {
  const segments = Array.from({ length: count }, (_, index) => ({
    key: `S${index}`,
    label: `Segment ${index}`,
    type: 'speech' as const,
    side: index % 2 === 0 ? ('affirmative' as const) : ('negative' as const),
    slot: 0,
    defaultDurationMs: 60_000,
  }));
  return {
    ...practiceFormatFixture,
    segments,
    configurable: {
      ...practiceFormatFixture.configurable,
      timing: {
        ...practiceFormatFixture.configurable.timing,
        segmentDurationMs: Object.fromEntries(
          segments.map((s) => [s.key, { min: 1_000, max: 600_000 }]),
        ),
      },
    },
  };
};
const rulesFor = (definition: FormatDefinition) => ({
  version: 2,
  seats: definition.seats,
  segments: definition.segments.map(({ defaultDurationMs, ...s }) => ({
    ...s,
    durationMs: defaultDurationMs,
  })),
  inRoundPrep: null,
  countdownMs: 0,
  interaction: { crossExMode: 'ordered', yield: null, interruptions: null },
});

test('accepted formats bound their segment schedule', () => {
  const accepted = withSegments(MAX_FORMAT_SEGMENTS),
    refused = withSegments(MAX_FORMAT_SEGMENTS + 1);
  assert({
    given: `${MAX_FORMAT_SEGMENTS} and ${MAX_FORMAT_SEGMENTS + 1} segments`,
    should: 'admit the limit in both grammars and refuse one more',
    actual: {
      limit: MAX_FORMAT_SEGMENTS,
      accepted: [
        formatDefinitionSchema.safeParse(accepted).success,
        roundRulesSchema.safeParse(rulesFor(accepted)).success,
      ],
      refused: [
        formatDefinitionSchema.safeParse(refused).success,
        roundRulesSchema.safeParse(rulesFor(refused)).success,
      ],
    },
    expected: {
      limit: 64,
      accepted: [true, true],
      refused: [false, false],
    },
  });
});

test('capability choice arrays are bounded sets over their vocabulary', () => {
  const { configurable } = practiceFormatFixture;
  const variant = (
    patch: Partial<FormatDefinition['configurable']>,
  ): FormatDefinition => ({
    ...practiceFormatFixture,
    configurable: { ...configurable, ...patch },
  });
  const prep = configurable.inRoundPrep!,
    interruptions = configurable.interaction.interruptions!,
    choices = configurable.interaction.yield!;
  const duplicates = [
    variant({
      inRoundPrep: { ...prep, spendableBefore: ['speech', 'speech'] },
    }),
    variant({
      interaction: {
        ...configurable.interaction,
        crossExModes: ['free', 'free'],
      },
    }),
    variant({
      interaction: {
        ...configurable.interaction,
        interruptions: { ...interruptions, modes: ['enabled', 'enabled'] },
      },
    }),
    variant({
      interaction: {
        ...configurable.interaction,
        yield: { ...choices, enabledChoices: [true, true, false] },
      },
    }),
    variant({
      interaction: {
        ...configurable.interaction,
        yield: { ...choices, returnsTimeChoices: [false, false] },
      },
    }),
  ];
  assert({
    given: 'a repeated choice in each capability array',
    should: 'refuse the definition',
    actual: duplicates.map((d) => formatDefinitionSchema.safeParse(d).success),
    expected: duplicates.map(() => false),
  });
  assert({
    given: 'every vocabulary value exactly once',
    should: 'still admit the definition',
    actual: formatDefinitionSchema.safeParse(practiceFormatFixture).success,
    expected: true,
  });
});

test('resolved rules refuse a repeated prep choice', () => {
  const rules = {
    ...rulesFor(practiceFormatFixture),
    inRoundPrep: {
      budgetMsPerSide: 0,
      spendableBefore: ['speech', 'speech'],
      expiresAtSegment: null,
    },
  };
  assert({
    given: 'resolved rules spendable before the same segment type twice',
    should: 'refuse the rules',
    actual: roundRulesSchema.safeParse(rules).success,
    expected: false,
  });
});
