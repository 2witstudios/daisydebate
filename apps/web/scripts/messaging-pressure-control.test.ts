import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingPressureControl } from '../e2e/support/messaging-pressure-control';
setupRitewayBun();

test('delayed A preparation cannot dispose or publish over acknowledged B', async () => {
  const aReady = Promise.withResolvers<void>();
  const bReady = Promise.withResolvers<void>();
  const events: string[] = [];
  const control = createMessagingPressureControl({
    allow: async () => {
      events.push('allow');
    },
    prepare: async (scope: string) => {
      events.push(`prepare ${scope}`);
      await (scope === 'A' ? aReady.promise : bReady.promise);
    },
  });
  const a = control.prepare('history', async () => 'A');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const b = control.prepare('entry', async () => 'B');
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    assert({
      given: 'A awaits its real holder ACK when B preparation arrives',
      should:
        'withhold B setup and both mode publications until A transition completes',
      actual: { events: [...events], mode: control.mode() },
      expected: { events: ['allow', 'prepare A'], mode: null },
    });
  } finally {
    aReady.resolve();
    bReady.resolve();
    await Promise.all([a, b]);
  }
  assert({
    given: 'both delayed preparations now complete in command order',
    should: 'leave B acknowledged and active with no late A global cleanup',
    actual: { events: [...events], mode: control.mode() },
    expected: {
      events: ['allow', 'prepare A', 'allow', 'prepare B'],
      mode: 'entry',
    },
  });
  await control.allow();
  assert({
    given: 'an explicit latest revoke acknowledged full release',
    should: 'publish no later mode or resurrect a previous owner',
    actual: { mode: control.mode(), finalEvent: events.at(-1) },
    expected: { mode: null, finalEvent: 'allow' },
  });
});
