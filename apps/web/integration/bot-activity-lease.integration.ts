import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  captureActivityRelay,
  captureOperations,
  captureWorkerScope,
  startCaptureSpeech,
  withMediaRound,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('an expired lease, ended session or unsafe session refuses relay on the admitted and the fresh path alike (CAP-E.1-r5)', async () => {
  await withMediaRound(async (f) => {
    const scope = await captureWorkerScope(f);
    const capture = captureOperations(f);
    const lease = await capture.claimMediaWorkerLease({
      ...scope,
      leaseMs: 15000,
    });
    const identity = { ...scope, epoch: lease.epoch };
    await startCaptureSpeech(f);
    const segmentId = (await capture.readMediaCaptureState(identity)).segment!
      .id;
    const [{ id: host }] =
      await f.sql`select p.id from round_participants p where p.round_id=${f.roundId} and p.actor_id=${f.host.actorId}`;
    let sequence = 0;
    const batch = async () => {
      const [{ now }] = await f.sql`select clock_timestamp() as now`;
      const nowMs = new Date(now).getTime();
      sequence += 1;
      return {
        version: 1,
        roundParticipantId: String(host),
        segmentId,
        frames: [
          {
            trackId: 'host-track',
            sequence,
            pcm: Array<number>(160).fill(1),
            beforeMs: sequence * 10,
            afterMs: sequence * 10 + 10,
            serverWindow: {
              before: new Date(nowMs - 20).toISOString(),
              after: new Date(nowMs - 10).toISOString(),
            },
          },
        ],
      };
    };
    const outcomes: string[] = [];
    const attempt = (relay: ReturnType<typeof captureActivityRelay>) =>
      batch().then((body) =>
        relay(identity, body).then(
          () => 'relayed',
          (error: { code?: string }) => error.code ?? 'error',
        ),
      );
    for (const [close, reopen] of [
      [
        f.sql`update media_worker_leases set expires_at=clock_timestamp()-interval '1 second' where session_id=${scope.sessionId}`,
        f.sql`update media_worker_leases set expires_at=clock_timestamp()+interval '15 seconds' where session_id=${scope.sessionId}`,
      ],
      [
        f.sql`update media_sessions set unsafe_at=clock_timestamp() where id=${scope.sessionId}`,
        f.sql`update media_sessions set unsafe_at=null where id=${scope.sessionId}`,
      ],
      [
        f.sql`update media_sessions set ended_at=clock_timestamp() where id=${scope.sessionId}`,
        f.sql`update media_sessions set ended_at=null where id=${scope.sessionId}`,
      ],
    ] as const) {
      const admitted = captureActivityRelay(f, capture);
      outcomes.push(await attempt(admitted));
      await close;
      outcomes.push(await attempt(admitted));
      outcomes.push(await attempt(captureActivityRelay(f, capture)));
      outcomes.push(await attempt(admitted));
      await reopen;
    }
    assert({
      given:
        'an admitted seat whose lease then expires, whose session turns unsafe, or whose session ends',
      should:
        'refuse every later batch, whether already admitted or freshly admitted, never alternating',
      actual: outcomes,
      expected: Array(3)
        .fill(['relayed', 'CONFLICT', 'CONFLICT', 'CONFLICT'])
        .flat(),
    });
  });
});
