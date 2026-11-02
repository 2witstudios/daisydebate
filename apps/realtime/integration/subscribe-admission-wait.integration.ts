import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { testNamespace } from '@daisy/redis/testing';
import { createRealtimeApp } from '../src/app';
import { refuseAllReading } from '../src/authorization.test-support';
import { serveRealtime } from '../src/serve';
import { openAuthorityPeer } from './authority-peer.test-support';
import { roundAudienceFixture } from './round-audience.test-support';
import {
  authorityParticipant,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { testOrigin, waitFor } from './support';

setupRitewayBun();
const services = requireTestServices(process.env);

/** Well past the 250 ms the admission lane used to allow a waiter (ISSUE-914). */
const FENCE_HELD_MS = 500;
const instant = '2026-10-09T00:00:00.000Z';

/**
 * ISSUE-914, on the real socket, the production lane pools and PostgreSQL. A
 * writer holds one participant's account fence, as every account command
 * does; that participant's hello waits on it holding the admission lane's one
 * connection. Another participant's first subscribe queues behind that read
 * and must wait its turn, not be refused for queueing.
 */
test('a first Round subscribe queued behind another participant blocked on their account fence is accepted', async () => {
  const admin = new SQL(services.databaseUrl);
  const resources = createRealtimeApp({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
    },
    clock: { now: () => instant },
  });
  const debater = authorityParticipant(admin);
  const fenced = authorityParticipant(admin);
  const rounds = roundAudienceFixture(admin, debater.actorId);
  let runtime: Awaited<ReturnType<typeof serveRealtime>> | undefined;
  try {
    await debater.seed();
    await fenced.seed();
    const round = await rounds.seed('private', 'affirmative');
    runtime = await serveRealtime({
      resources,
      readingPolicy: refuseAllReading,
      port: 0,
      hostname: '127.0.0.1',
      now: () => 0,
      timers: { setInterval, clearInterval },
    });
    const port = runtime.server.port!;
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket({ resources, ...debater }),
    );
    const held = await issueAuthorityTicket({ resources, ...fenced });
    let fencedPeer: ReturnType<typeof openAuthorityPeer> | undefined;
    const answersWhileHeld = await admin.begin(async (writer) => {
      await writer`select id from users where id=${fenced.userId} for update`;
      fencedPeer = openAuthorityPeer(port, held);
      let waiting = 0;
      for (let polls = 0; polls < 250 && waiting === 0; polls += 1) {
        const [row] = await admin`
          select count(*)::int as waiting from pg_stat_activity
          where wait_event_type = 'Lock' and datname = current_database()`;
        waiting = row.waiting;
        if (waiting === 0) await Bun.sleep(20);
      }
      if (waiting === 0) throw new Error('The hello never reached the fence');
      peer.socket.send(
        JSON.stringify({
          v: ENVELOPE_VERSION,
          type: 'subscribe',
          id: 'first',
          topic: round.topic,
        }),
      );
      await Bun.sleep(FENCE_HELD_MS);
      return peer.frames.filter(
        (frame) => 'id' in frame && frame.id === 'first',
      );
    });
    const second = await fencedPeer!;
    await waitFor(() =>
      peer.frames.some((frame) => 'id' in frame && frame.id === 'first'),
    );
    assert({
      given: 'the fence held past the old lane wait',
      should: 'leave the queued subscribe waiting, not refused',
      actual: answersWhileHeld,
      expected: [],
    });
    assert({
      given: 'the writer commits and the fence is released',
      should: 'accept the first subscribe without a refusal',
      actual: peer.frames.flatMap((frame) =>
        'id' in frame && frame.id === 'first' ? [frame.type] : [],
      ),
      expected: ['subscribed'],
    });
    peer.socket.close();
    second.socket.close();
  } finally {
    await runtime?.close();
    await resources.close();
    await rounds.close();
    await fenced.erase();
    await debater.erase();
    await admin.close();
  }
}, 30_000);
