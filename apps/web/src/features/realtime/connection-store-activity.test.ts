import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { harness, openAndReady } from './connection-store.test-support';

setupRitewayBun();

const activities = (sent: readonly string[]) =>
  sent
    .map((frame) => JSON.parse(frame) as { type: string; activity?: string })
    .filter((frame) => frame.type === 'presence.activity')
    .map((frame) => frame.activity);

describe('connection store: presence activity (ADR 0033 §1, ADR 0072)', () => {
  test('a presence connection reports on ready and once per change', async () => {
    const h = harness({ reportsPresence: true });
    await openAndReady(h);
    h.store.reportActivity('idle');
    h.store.reportActivity('idle');
    h.store.reportActivity('active');
    assert({
      given: 'ready, then idle twice and active',
      should: 'report active on ready, then each change once',
      actual: activities(h.latestSocket().sent),
      expected: ['active', 'idle', 'active'],
    });
  });

  test('a presence connection that opens while idle reports idle on ready', async () => {
    const h = harness({ reportsPresence: true });
    h.store.reportActivity('idle');
    await openAndReady(h);
    assert({
      given: 'idle reported before the socket was ready',
      should: 'start its lease idle',
      actual: activities(h.latestSocket().sent),
      expected: ['idle'],
    });
  });

  test('any other connection never reports presence', async () => {
    const h = harness();
    await openAndReady(h);
    h.store.reportActivity('idle');
    assert({
      given: 'a room or conversation connection told about activity',
      should: 'send no presence frame, so it never keeps its member online',
      actual: activities(h.latestSocket().sent),
      expected: [],
    });
  });
});
