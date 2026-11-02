import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  holdingFence,
  productionLanes,
  sendHello,
  type LaneWorld,
} from './production-lanes.test-support';
import { waitFor } from './support';

setupRitewayBun();

type Peer = Awaited<ReturnType<LaneWorld['connect']>>;
const answersTo = (peer: Peer, id: string) =>
  peer.frames.flatMap((frame) =>
    'id' in frame && frame.id === id
      ? [frame.type === 'error' ? frame.code : frame.type]
      : [],
  );

/**
 * ISSUE-914. One participant's hello waits on their account fence holding the
 * admission lane's one connection, so another participant's first subscribe
 * queues on the real lane, and only the test ends the waiter's bound.
 */
async function queuedBehindAFence(
  world: LaneWorld,
  elapsedMs: number,
  settled: (peer: Peer) => Promise<void>,
) {
  const round = await world.rounds.seed('private', 'affirmative');
  const peer = await world.connect(world.debater);
  const ticket = await world.ticket(world.fenced);
  await holdingFence(world, async (blocked) => {
    const held = sendHello(world.port, ticket);
    await blocked();
    peer.ask(round.topic, 'first');
    await waitFor(() => world.queuedBounds().length > 0);
    world.expireWaiters(elapsedMs);
    await settled(peer);
    held.socket.close();
  });
  await waitFor(() => answersTo(peer, 'first').length > 0);
  peer.socket.close();
  return answersTo(peer, 'first');
}

test(
  'a first Round subscribe queued past the old 250 ms bound behind another participant is accepted',
  () =>
    productionLanes(async (world) => {
      assert({
        given: 'a queued subscribe at 2,999 ms on the lane',
        should: 'still be waiting, and be accepted when the fence is released',
        actual: await queuedBehindAFence(world, 2_999, async () => {}),
        expected: ['subscribed'],
      });
    }),
  30_000,
);

test(
  'a subscribe queued to the lane bound is refused as transient',
  () =>
    productionLanes(async (world) => {
      assert({
        given: 'a queued subscribe reaching 3,000 ms on the lane',
        should: 'answer INFRASTRUCTURE, which the existing retry owner handles',
        actual: await queuedBehindAFence(world, 3_000, (peer) =>
          waitFor(() => answersTo(peer, 'first').length > 0),
        ),
        expected: ['INFRASTRUCTURE'],
      });
    }),
  30_000,
);

/**
 * More than three debate seats bring at Round start: sockets connect one at a
 * time (at most 8 per actor, 4 unauthenticated), then all subscribe together
 * on the real waiter timer, three lane transactions each.
 */
test(
  'a burst of first subscribes on real reads is accepted by the one connection',
  () =>
    productionLanes(
      async (world) => {
        const SOCKETS = 8;
        const TOPICS = 5;
        const topics: string[] = [];
        for (let index = 0; index < TOPICS; index += 1)
          topics.push(
            (await world.rounds.seed('private', 'affirmative')).topic,
          );
        const peers: Peer[] = [];
        for (let index = 0; index < SOCKETS; index += 1)
          peers.push(await world.connect(world.debater));
        const asks = peers.flatMap((peer) =>
          topics.map((topic, index) => ({ peer, id: `t${index}`, topic })),
        );
        asks.forEach(({ peer, id, topic }) => peer.ask(topic, id));
        await waitFor(
          () => asks.every(({ peer, id }) => answersTo(peer, id).length > 0),
          10_000,
        );
        peers.forEach((peer) => peer.socket.close());
        assert({
          given: `${SOCKETS * TOPICS} first subscribes arriving together`,
          should: 'accept every one',
          actual: asks.flatMap(({ peer, id }) => answersTo(peer, id)),
          expected: Array(SOCKETS * TOPICS).fill('subscribed'),
        });
      },
      { realWaiters: true },
    ),
  30_000,
);
