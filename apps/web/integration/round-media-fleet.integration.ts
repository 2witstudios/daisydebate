import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createMediaService } from '@daisy/media';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { mediaDependencies, withMediaRound } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('one actual provider failure does not prevent cleanup of another terminal media session', async () => {
  await withMediaRound(async (f) => {
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    // A second Room needs its own cast: one user holds one active Room (ADR 0070).
    const cast = await f.freshCast();
    const fresh = await f.command(cast.host, await f.assemble({}, cast), {
      type: 'start-round',
    });
    const terminalRoundId = fresh.view.roundRef!.id;
    await f.mediaOperations.session(terminalRoundId, cast.host.actorId);
    const sessions = await f.store.mediaSessions.activeMediaSessions();
    const [failed] =
      await f.sql`select room_name from media_sessions where round_id=${f.roundId}`;
    const [terminal] =
      await f.sql`select room_name from media_sessions where round_id=${terminalRoundId}`;
    await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${terminalRoundId}`;
    let blocked = true;
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.arrayBuffer();
        if (
          blocked &&
          url.pathname.endsWith('/ListRooms') &&
          JSON.parse(new TextDecoder().decode(body)).names?.includes(
            failed!.room_name,
          )
        )
          return new Response('Unavailable', { status: 503 });
        return fetch(`${f.mediaConfig.url}${url.pathname}`, {
          method: request.method,
          headers: request.headers,
          body,
        });
      },
    });
    const reports: string[] = [];
    const operations = createRoundMediaOperations({
      ...mediaDependencies(
        f,
        createMediaService({
          config: { ...f.mediaConfig, url: `http://127.0.0.1:${proxy.port}` },
        }),
      ),
      reporter: {
        capture: (_error, context) => {
          reports.push(context.errorCode);
        },
      },
    });
    try {
      await operations.recoverActiveSessions();
      const [closed] =
        await f.sql`select ended_at from media_sessions where round_id=${terminalRoundId}`;
      assert({
        given:
          'an actual vendor ListRooms503 for one session and an unrelated terminal commit',
        should:
          'report the failed session and verify actual deletion of the terminal room in the same cycle',
        actual: [
          sessions.length >= 2,
          reports.includes('INFRASTRUCTURE'),
          closed!.ended_at !== null,
          await f.media.exists(terminal!.room_name),
        ],
        expected: [true, true, true, false],
      });
      blocked = false;
      await operations.recoverActiveSessions();
      const [recovered] =
        await f.sql`select unsafe_at from media_sessions where round_id=${f.roundId}`;
      assert({
        given: 'actual vendor ingress restored on a later recovery cycle',
        should:
          'clear unsafe only after provider cleanup while preserving the active Round',
        actual: [
          recovered!.unsafe_at,
          (await f.store.getRound(f.roundId))!.status,
        ],
        expected: [null, 'scheduled'],
      });
    } finally {
      proxy.stop(true);
      if (await f.media.exists(terminal!.room_name))
        await f.media.deleteRoom(terminal!.room_name);
    }
  });
});
