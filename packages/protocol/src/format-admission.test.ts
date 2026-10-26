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
  formatWithSegments,
} from './format-fixtures.test-support';

setupRitewayBun();

test('custom format admission rejects invalid seats, defaults, bounds and unused prep references', () => {
  assert({
    given: 'the independently reproduced invalid custom schedules',
    should: 'reject each before it enters a portable Room command',
    actual: invalidFormatDefinitions.map(
      ([, definition]) => formatDefinitionSchema.safeParse(definition).success,
    ),
    expected: invalidFormatDefinitions.map(() => false),
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
