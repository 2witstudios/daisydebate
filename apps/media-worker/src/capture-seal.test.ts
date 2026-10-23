import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { sealCaptureStreams } from './capture-session';
setupRitewayBun();

const stream = (segmentId: string) => ({
  segmentId,
  roundParticipantId: 'p'.repeat(24),
  count: 0,
});

test('only a seal refused for its open timeline stays due', async () => {
  const replies: Record<string, () => Response> = {
    ['o'.repeat(24)]: () =>
      Response.json(
        { error: { code: 'CONFLICT' }, refusal: 'timeline-open' },
        { status: 409 },
      ),
    ['d'.repeat(24)]: () =>
      Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }),
    ['s'.repeat(24)]: () => Response.json({ state: 'complete', revision: 2 }),
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) =>
      replies[((await request.json()) as { segmentId: string }).segmentId]!(),
  });
  const finished: string[] = [];
  try {
    const sealed = await sealCaptureStreams(
      createMediaWorkerClient({
        scope: {
          roundId: 'r'.repeat(24),
          sessionId: 'n'.repeat(24),
          workerId: 'w'.repeat(24),
        },
        authentication: createMediaWorkerAuthentication({
          secret: Buffer.alloc(32, 6).toString('base64url'),
          now: () => 1000,
        }),
        url: `http://127.0.0.1:${server.port}`,
        fetch,
        nowMs: performance.now,
        deadlineSignal: () => AbortSignal.timeout(2000),
      }),
      3,
      Object.keys(replies).map(stream),
      AbortSignal.timeout(2000),
      (each) => finished.push(each.segmentId[0]!),
    );
    assert({
      given:
        'one seal refused for an open timeline, one refused definitely, one sealed',
      should:
        'finish the definite refusal and the seal, leaving only the open timeline due (VIDEO-4.1-r1)',
      actual: { sealed, finished },
      expected: { sealed: 1, finished: ['d', 's'] },
    });
  } finally {
    await server.stop(true);
  }
});
