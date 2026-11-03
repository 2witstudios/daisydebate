import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMediaService } from '@daisy/media';
import { Room } from '@livekit/rtc-node';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import {
  localMediaConfig,
  mediaDependencies,
  tokenClaims,
  withMediaRound,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

/**
 * The node as the web tier sees it through its proxy. `failing` answers a 503,
 * which proves nothing about whether the node applied the call.
 */
function nodeBehindProxy() {
  let failing: (path: string) => boolean = () => false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (failing(url.pathname)) return new Response(null, { status: 503 });
      return fetch(`${localMediaConfig.url}${url.pathname}`, {
        method: request.method,
        headers: request.headers,
        body: await request.arrayBuffer(),
      });
    },
  });
  return {
    config: { ...localMediaConfig, url: `http://127.0.0.1:${server.port}` },
    fail: (rule: (path: string) => boolean) => {
      failing = rule;
    },
    stop: () => server.stop(true),
  };
}

test('a permission call lost to a dying node never strands the session', async () => {
  await withMediaRound(async (f) => {
    const node = nodeBehindProxy();
    const operations = createRoundMediaOperations(
      mediaDependencies(f, createMediaService({ config: node.config })),
    );
    const seat = new Room();
    try {
      const admitted = await operations.session(f.roundId, f.host.actorId);
      await seat.connect('ws://127.0.0.1:7880', admitted.token, {
        autoSubscribe: false,
        dynacast: false,
      });
      const [before] =
        await f.sql`select id,room_name from media_sessions where round_id=${f.roundId}`;
      // LiveKit now disagrees with the floor, so the next pass must write a permission.
      await createMediaService({ config: localMediaConfig }).permissions(
        String(before!.room_name),
        admitted.identity,
        { publish: [], subscribe: false, hidden: false, capture: false },
      );
      // It still lists rooms, but neither write comes back.
      node.fail(
        (path) =>
          path.endsWith('/UpdateParticipant') || path.endsWith('/DeleteRoom'),
      );
      await operations.recoverActiveSessions().catch(() => undefined);
      const [lost] =
        await f.sql`select unsafe_at,(select count(*)::int from media_vendor_mutations where session_id=s.id and settled_at is null) pending from media_sessions s where id=${before!.id}`;
      assert({
        given: 'a permission call and its cleanup answered by a 503',
        should: 'hold both outcomes as unknown and close admission',
        actual: [lost!.unsafe_at !== null, lost!.pending],
        expected: [true, 2],
      });
      node.fail(() => true);
      const until = performance.now() + 12_000;
      for (;;) {
        await operations.recoverActiveSessions().catch(() => undefined);
        const [row] =
          await f.sql`select unsafe_at from media_sessions where id=${before!.id}`;
        if (row!.unsafe_at === null) break;
        if (performance.now() >= until)
          throw new Error('The session stayed unsafe past the bound');
        await Bun.sleep(100);
      }
      const [retired] =
        await f.sql`select room_name,deletion_requested_at,(select count(*)::int from media_vendor_mutations where session_id=s.id and settled_at is null) pending,(select count(*)::int from media_vendor_mutations where session_id=s.id and outcome='superseded') superseded from media_sessions s where id=${before!.id}`;
      assert({
        given: 'the node staying unreachable past the retirement bound',
        should:
          'retire the room with the node still down: a fresh name, nothing pending, the lost call fenced rather than invented',
        actual: [
          retired!.room_name !== before!.room_name,
          retired!.deletion_requested_at,
          retired!.pending,
          retired!.superseded > 0,
        ],
        expected: [true, null, 0, true],
      });
      node.fail(() => false);
      const back = await operations.session(f.roundId, f.host.actorId);
      assert({
        given: 'a healthy node after retirement',
        should: 'admit the same seat identity into the fresh room',
        actual: [
          back.identity,
          tokenClaims(back.token).video.room,
        ],
        expected: [admitted.identity, retired!.room_name],
      });
    } finally {
      await seat.disconnect();
      node.stop();
    }
  });
}, 40_000);
