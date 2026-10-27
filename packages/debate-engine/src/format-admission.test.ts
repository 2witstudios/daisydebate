import { assert, setupRitewayBun, test } from 'riteway/bun';
import { formatDefinitionSchema } from '@daisy/protocol';
import {
  invalidFormatDefinitions,
  unsafeFormatDefinitions,
  oneOnOneFormatFixture,
} from '@daisy/protocol/testing';
import { unboundedFormatDefinitions } from '@daisy/protocol/format-bounds-testing';
import { oneOnOneConfig } from './runtime.test-support';
import { resolveRoomConfiguration } from './resolve-room-configuration';

setupRitewayBun();

for (const [name, definition] of [
  ...invalidFormatDefinitions,
  ...unsafeFormatDefinitions,
  ...unboundedFormatDefinitions,
]) {
  test(`rejects ${name} before compiling executable rules`, () => {
    const outcome = resolveRoomConfiguration(definition, {
      ...oneOnOneConfig,
      inRoundPrep: { enabled: false },
    });
    assert({
      given: name,
      should: 'refuse at both JSON admission and the pure compiler boundary',
      actual: [
        formatDefinitionSchema.safeParse(definition).success,
        outcome.ok,
      ],
      expected: [false, false],
    });
  });
}

test('compiler preserves bounded asymmetric sides and a cross-ex-only speaking side', () => {
  const definition = {
    ...oneOnOneFormatFixture,
    seats: { affirmative: 255, negative: 1, judge: 0 },
    segments: oneOnOneFormatFixture.segments.map((s) =>
      s.side === 'negative' ? { ...s, type: 'cross_ex' as const } : s,
    ),
  };
  const result = resolveRoomConfiguration(definition, oneOnOneConfig);
  assert({
    given: 'a two-sided format at the work boundary without judges',
    should:
      'compile every seat and preserve legal speech and cross-ex opportunities',
    actual: result.ok && [
      result.rules.seats,
      result.rules.segments.map((s) => s.type),
    ],
    expected: [definition.seats, definition.segments.map((s) => s.type)],
  });
});
