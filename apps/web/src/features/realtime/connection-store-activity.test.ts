import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { harness, openAndReady } from './connection-store.test-support';

setupRitewayBun();

const activityFrames = (sent: readonly string[]) =>
  sent
    .map(
      (frame) =>
        JSON.parse(frame) as { v: number; type: string; activity?: string },
    )
    .filter((frame) => frame.type === 'presence.activity');

describe('connection store: presence activity (ADR 0033 §1)', () => {
  test('an open socket carries each change of activity once', async () => {
    const h = harness();
    await openAndReady(h);
    h.store.reportActivity('idle');
    h.store.reportActivity('idle');
    h.store.reportActivity('active');
    assert({
      given: 'idle twice and then active on an open socket',
      should: 'send one frame per change',
      actual: activityFrames(h.latestSocket().sent),
      expected: [
        { v: ENVELOPE_VERSION, type: 'presence.activity', activity: 'idle' },
        { v: ENVELOPE_VERSION, type: 'presence.activity', activity: 'active' },
      ],
    });
  });

  test('a socket that opens while idle reports idle on ready', async () => {
    const h = harness();
    h.store.reportActivity('idle');
    await openAndReady(h);
    assert({
      given: 'idle reported before the socket was ready',
      should: 'send idle once ready, since a new lease starts active',
      actual: activityFrames(h.latestSocket().sent).map(
        (frame) => frame.activity,
      ),
      expected: ['idle'],
    });
  });

  test('an active socket sends nothing on ready', async () => {
    const h = harness();
    await openAndReady(h);
    assert({
      given: 'no activity reported',
      should: 'send no activity frame',
      actual: activityFrames(h.latestSocket().sent),
      expected: [],
    });
  });
});
