import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  MAX_FORMAT_SEGMENTS,
  formatDefinitionSchema,
  roundRulesSchema,
} from './format';
import {
  fixtureRules,
  invalidFormatDefinitions,
  unsafeFormatDefinitions,
  oneOnOneFormatFixture,
} from './format-fixtures.test-support';
import {
  formatWithSegments,
  unboundedFormatDefinitions,
} from './format-bounds.test-support';

setupRitewayBun();

test('custom format admission rejects invalid seats, defaults, bounds and unused prep references', () => {
  assert({
    given: 'the independently reproduced invalid custom schedules',
    should: 'reject each before it enters a portable Room command',
    actual: [...invalidFormatDefinitions, ...unboundedFormatDefinitions].map(
      ([, definition]) => formatDefinitionSchema.safeParse(definition).success,
    ),
    expected: [...invalidFormatDefinitions, ...unboundedFormatDefinitions].map(
      () => false,
    ),
  });
});

const refusalPaths = [
  [['seats', 'affirmative'], ['seats']],
  [['seats', 'negative'], ['seats']],
  [['seats', 'judge'], ['seats']],
  [['seats']],
  [['seats', 'negative'], ['segments']],
  [['segments']],
  [['seats', 'affirmative'], ['seats']],
  [['seats', 'negative'], ['seats']],
  [['seats', 'judge'], ['seats']],
  [['seats', 'affirmative'], ['segments']],
  [['segments']],
  [['seats', 'negative']],
];

for (const [index, [name, definition]] of unsafeFormatDefinitions.entries()) {
  test(`definition and resolved rules refuse ${name}`, () => {
    const rules = fixtureRules(definition);
    assert({
      given: name,
      should:
        'identify the unsafe seats or missing speaking opportunity in both grammars',
      actual: [
        formatDefinitionSchema
          .safeParse(definition)
          .error?.issues.map((issue) => issue.path),
        roundRulesSchema
          .safeParse(rules)
          .error?.issues.map((issue) => issue.path),
      ],
      expected: [refusalPaths[index], refusalPaths[index]],
    });
  });
}

test('resource boundary accepts unequal sides and optional judges with speech or cross-ex opportunity', () => {
  const variants = [
    { affirmative: 255, negative: 1, judge: 0 },
    { affirmative: 1, negative: 1, judge: 254 },
    { affirmative: 2, negative: 3, judge: 0 },
  ];
  assert({
    given:
      '256 total seats and a side whose only speaking interval is cross-ex',
    should:
      'admit unequal rosters without requiring judges or a speech per side',
    actual: variants.map((seats) => {
      const definition = {
        ...oneOnOneFormatFixture,
        seats,
        segments: oneOnOneFormatFixture.segments.map((s) =>
          s.side === 'negative' ? { ...s, type: 'cross_ex' as const } : s,
        ),
      };
      return [
        formatDefinitionSchema.safeParse(definition).data?.seats,
        roundRulesSchema.safeParse(fixtureRules(definition)).data?.seats,
      ];
    }),
    expected: variants.map((seats) => [seats, seats]),
  });
});

test('definitions and resolved rules admit exactly MAX_FORMAT_SEGMENTS segments', () => {
  const rulesFor = (definition: ReturnType<typeof formatWithSegments>) => ({
    ...fixtureRules(oneOnOneFormatFixture),
    segments: definition.segments.map(({ defaultDurationMs, ...segment }) => ({
      ...segment,
      durationMs: defaultDurationMs,
    })),
  });
  assert({
    given: 'a definition and its rules at 64 segments, then at 65 (DEC-131)',
    should: 'accept the limit and refuse one over, at the protocol boundary',
    actual: [64, 65].map((count) => {
      const definition = formatWithSegments(count);
      return [
        formatDefinitionSchema.safeParse(definition).success,
        roundRulesSchema.safeParse(rulesFor(definition)).success,
      ];
    }),
    expected: [
      [true, true],
      [false, false],
    ],
  });
  assert({
    given: 'the published bound',
    should: 'be 64',
    actual: MAX_FORMAT_SEGMENTS,
    expected: 64,
  });
});
