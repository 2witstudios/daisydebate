import { assert, setupRitewayBun, test } from 'riteway/bun';
import { formatDefinitionSchema } from '@daisy/protocol';
import { invalidFormatDefinitions } from '@daisy/protocol/testing';
import { practiceConfig } from './runtime.test-support';
import { resolveRoomConfiguration } from './resolve-room-configuration';

setupRitewayBun();

for (const [name, definition] of invalidFormatDefinitions) {
  test(`rejects ${name} before compiling executable rules`, () => {
    const outcome = resolveRoomConfiguration(definition, {
      ...practiceConfig,
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
