import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import {
  holdingFence,
  productionLanes,
  sendHello,
  type LaneWorld,
} from './production-lanes.test-support';

setupRitewayBun();

/** A read blocked to the real 2 s lock bound fails rather than answering. */
const reconnects = async (world: LaneWorld) => {
  const peer = await world.connect(world.fenced);
  const ready = peer.frames.some((frame) => frame.type === 'ready');
  peer.socket.close();
  return ready;
};

test(
  'a hello whose check times out on the fence closes retryably and the reconnect is answered',
  () =>
    productionLanes(async (world) => {
      const ticket = await world.ticket(world.fenced);
      const code = await holdingFence(world, async (blocked) => {
        const held = sendHello(world.port, ticket);
        await blocked();
        return held.closed;
      });
      assert({
        given: 'a hello blocked past the session lock bound',
        should: 'close 4007, log a lock timeout, then accept a fresh ticket',
        actual: [code, await reconnects(world)],
        expected: [4007, true],
      });
    }),
  30_000,
);

test(
  'a frame whose principal check times out on the fence closes retryably, not as revoked',
  () =>
    productionLanes(async (world) => {
      const peer = await world.connect(world.fenced);
      const code = await holdingFence(world, async (blocked) => {
        peer.socket.send(
          JSON.stringify({ v: ENVELOPE_VERSION, type: 'ping', id: 'p1' }),
        );
        await blocked();
        return peer.closed;
      });
      assert({
        given: 'a frame check blocked past the session lock bound',
        should: 'close 4007, log a lock timeout, then accept a fresh ticket',
        actual: [code, await reconnects(world)],
        expected: [4007, true],
      });
    }),
  30_000,
);

test(
  'a periodic check that times out closes retryably; a real revocation still closes as revoked',
  () =>
    productionLanes(async (world) => {
      const peer = await world.connect(world.fenced);
      const code = await holdingFence(world, async (blocked) => {
        world.revalidate();
        await blocked();
        return peer.closed;
      });
      const again = await world.connect(world.fenced);
      await world.admin`delete from session where id=${world.fenced.sessionId}`;
      again.socket.send(
        JSON.stringify({ v: ENVELOPE_VERSION, type: 'ping', id: 'p1' }),
      );
      assert({
        given:
          'a periodic check blocked past the lock bound, then a deleted session',
        should: 'close 4007 for the first and 4002 for the real revocation',
        actual: [code, await again.closed],
        expected: [4007, 4002],
      });
    }),
  30_000,
);
