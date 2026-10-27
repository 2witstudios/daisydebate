import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotListenerClient } from './bot-listener-client';
import { authentication, scope } from './worker-client.test-support';

setupRitewayBun();
test('the bot listener calls only its own signed routes (ISSUE-764)', async () => {
  const seen: { path: string; role: string }[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      const body = await request.text();
      const principal = authentication.verify({
        method: request.method,
        path,
        body,
        timestamp: request.headers.get('x-daisy-media-timestamp') ?? '',
        signature: request.headers.get('x-daisy-media-signature') ?? '',
      });
      seen.push({ path, role: principal.role });
      const operation = path.split('/').at(-1);
      if (operation === 'lease')
        return Response.json({
          epoch: 2,
          expiresAt: '2026-10-27T12:00:15.000Z',
        });
      if (operation === 'read')
        return Response.json({
          roundId: scope.roundId,
          sessionId: scope.sessionId,
          serverNow: '2026-10-27T12:00:00.000Z',
          segment: null,
          participants: [],
          intervals: [],
        });
      return Response.json(null);
    },
  });
  try {
    const client = createBotListenerClient({
      scope,
      authentication,
      url: `http://127.0.0.1:${server.port}`,
      fetch,
      nowMs: performance.now,
      deadlineSignal: () => AbortSignal.timeout(2000),
    });
    const lease = await client.lease(15000);
    const read = await client.read(lease.epoch);
    await client.activity({
      epoch: lease.epoch,
      segmentId: 'g'.repeat(24),
      roundParticipantId: 'p'.repeat(24),
      frames: [
        {
          trackId: 'TR_a',
          sequence: 0,
          pcm: Array.from({ length: 160 }, () => 0),
          beforeMs: 0,
          afterMs: 10,
          serverWindow: {
            before: '2026-10-27T12:00:00.000Z',
            after: '2026-10-27T12:00:00.010Z',
          },
        },
      ],
    });
    const base = `/api/internal/media/${scope.roundId}/bot-listener`;
    assert({
      given: 'a lease, a read and an activity batch',
      should:
        'sign each as the bot-listener role on its own routes and read fresh server time',
      actual: [seen, read.calibration.serverNowMs],
      expected: [
        [
          { path: `${base}/lease`, role: 'bot-listener' },
          { path: `${base}/read`, role: 'bot-listener' },
          { path: `${base}/activity`, role: 'bot-listener' },
        ],
        Date.parse('2026-10-27T12:00:00.000Z'),
      ],
    });
  } finally {
    server.stop(true);
  }
});
