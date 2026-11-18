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

test('a setup that lost only to lane contention is prepared again, a bounded number of times', async () => {
  const contention = new Error('social lane wait expired');
  const run = async (failures: readonly Error[]) => {
    const events: string[] = [];
    let attempt = 0;
    const control = createMessagingPressureControl(
      {
        allow: async () => {
          events.push('allow');
        },
        prepare: async (scope: string) => {
          const failure = failures[attempt++];
          events.push(`prepare ${scope}`);
          if (failure) throw failure;
        },
      },
      (error) => error === contention,
    );
    const outcome = await control
      .prepare('history', async () => 'A')
      .then(
        () => 'held',
        (error: unknown) => (error === contention ? 'contended' : 'refused'),
      );
    return { outcome, events, mode: control.mode() };
  };
  assert({
    given: 'one contended setup, then a held one',
    should: 'read the selectors once, prepare twice and publish the mode',
    actual: await run([contention]),
    expected: {
      outcome: 'held',
      events: ['allow', 'prepare A', 'prepare A'],
      mode: 'history',
    },
  });
  assert({
    given: 'contention on every attempt',
    should: 'stop after three attempts and publish no mode',
    actual: await run([contention, contention, contention, contention]),
    expected: {
      outcome: 'contended',
      events: ['allow', 'prepare A', 'prepare A', 'prepare A'],
      mode: null,
    },
  });
  assert({
    given: 'a setup that failed for another reason',
    should: 'refuse at once, with no second attempt',
    actual: await run([new Error('holder fault')]),
    expected: {
      outcome: 'refused',
      events: ['allow', 'prepare A'],
      mode: null,
    },
  });
});
