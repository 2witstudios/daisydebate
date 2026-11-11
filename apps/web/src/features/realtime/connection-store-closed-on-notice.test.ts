import { assert, setupRitewayBun, test } from 'riteway/bun';
import { heartbeatMs } from '@daisy/protocol';
import { flush, harness, openAndReady } from './connection-store.test-support';

setupRitewayBun();

const downs = {
  'its socket closing under it': (h: ReturnType<typeof harness>) =>
    h.latestSocket().remoteClose(1006),
  'its socket reaped for answering no ping': (h: ReturnType<typeof harness>) =>
    h.scheduler.advance(heartbeatMs * 2),
};
const ends = {
  leaves: 'left',
  disposes: 'disposed',
} as const;

for (const [down, bringDown] of Object.entries(downs))
  for (const [verb, why] of Object.entries(ends))
    test(`a listener that ${verb} on the reconnecting notice, after ${down}`, async () => {
      const h = harness();
      await openAndReady(h);
      h.store.subscribe((state) => {
        if (state.status !== 'reconnecting') return;
        if (why === 'left') h.store.close();
        else h.store.dispose();
      });
      bringDown(h);
      const scheduled = h.scheduler.pending();
      h.scheduler.advance(600_000);
      await flush();
      const { status, ...rest } = h.store.getState();
      assert({
        given: `an open connection, ${down}, and a listener that ${verb} the store when told it is reconnecting`,
        should: 'be closed with nothing scheduled, and never connect again',
        actual: {
          status,
          why: 'why' in rest ? rest.why : null,
          scheduled,
          sockets: h.sockets.length,
        },
        expected: { status: 'closed', why, scheduled: 0, sockets: 1 },
      });
    });

test('a listener that connects on the reconnecting notice leaves no second retry', async () => {
  const h = harness();
  await openAndReady(h);
  h.store.subscribe((state) => {
    if (state.status === 'reconnecting') h.store.connect();
  });
  h.latestSocket().remoteClose(1006);
  const scheduled = h.scheduler.pending();
  h.scheduler.advance(600_000);
  await flush();
  assert({
    given:
      'a listener that connects at once when told the connection is reconnecting',
    should: 'open the one new socket and leave no retry scheduled behind it',
    actual: { scheduled, sockets: h.sockets.length },
    expected: { scheduled: 0, sockets: 2 },
  });
});
