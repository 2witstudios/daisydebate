import { assert, setupRitewayBun, test } from 'riteway/bun';
import { formatDefinitionSchema } from '@daisy/protocol/format';
import {
  invalidFormatDefinitions,
  unsafeFormatDefinitions,
  oneOnOneFormatFixture,
} from '@daisy/protocol/testing';
import { unboundedFormatDefinitions } from '@daisy/protocol/format-bounds-testing';
import { oneOnOneSettings } from './runtime.test-support';
import { resolveRoomConfiguration } from './resolve-room-configuration';

setupRitewayBun();

for (const [name, definition] of [
  ...invalidFormatDefinitions,
  ...unsafeFormatDefinitions,
  ...unboundedFormatDefinitions,
]) {
  test(`rejects ${name} before compiling executable rules`, () => {
    const outcome = resolveRoomConfiguration(definition, {
      ...oneOnOneSettings,
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
    seats: {
      ...oneOnOneFormatFixture.seats,
      sides: { affirmative: 255, negative: 1 },
      judges: 0,
    },
    segments: oneOnOneFormatFixture.segments.map((s) =>
      s.speak.rights === 'one' &&
      s.speak.seat.kind === 'side' &&
      s.speak.seat.side === 'negative'
        ? {
            ...s,
            type: 'cross_ex' as const,
            speak: { rights: 'all' as const, lead: s.speak.seat },
          }
        : s,
    ),
  };
  const result = resolveRoomConfiguration(definition, oneOnOneSettings);
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
