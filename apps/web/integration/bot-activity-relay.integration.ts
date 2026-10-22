import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotActivityRelay } from '../src/features/round-bots/activity-relay';
import {
  captureOperations,
  captureWorkerScope,
  withMediaRound,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('actual capture lease relays a bound seat with fresh PG receipt and no body authority', async () => {
  await withMediaRound(async (f) => {
    const scope = await captureWorkerScope(f);
    const capture = captureOperations(f);
    const lease = await capture.claimMediaWorkerLease({
      ...scope,
      leaseMs: 15000,
    });
    const identity = { ...scope, epoch: lease.epoch };
    const relay = createBotActivityRelay({
      readCapture: (value) => capture.readMediaCaptureState(value),
      write: f.redis.writeBotActivity,
    });
    const seats: { id: string; host: boolean }[] =
      await f.sql`select p.id, a.id = ${f.host.actorId} as host from round_participants p join actors a on a.id=p.actor_id where p.round_id=${f.roundId} and p.role<>'judge'`;
    const host = String(seats.find((row) => row.host)!.id);
    const guest = String(seats.find((row) => !row.host)!.id);
    const [{ now }] = await f.sql`select clock_timestamp() as now`;
    const nowMs = new Date(now).getTime();
    const original = {
      trackId: 'host-track',
      sequence: 7,
      pcm: Array<number>(160).fill(3),
      beforeMs: 41.25,
      afterMs: 51.5,
      serverWindow: {
        before: new Date(nowMs - 20).toISOString(),
        after: new Date(nowMs - 10).toISOString(),
      },
    };
    await relay(identity, {
      version: 1,
      roundParticipantId: host,
      frames: [original],
    });
    const stored = await f.redis.readBotActivity(f.roundId, host);
    const [{ after }] = await f.sql`select clock_timestamp() as after`;
    const receipt = Date.parse(stored!.frames[0]!.receivedAt);
    assert({
      given: 'a signed-lease worker relay for the actually bound host seat',
      should:
        'preserve original brackets and calibrated bounds and attach a fresh PG receipt',
      actual: {
        original: { ...stored!.frames[0]!, receivedAt: undefined },
        fresh: receipt >= nowMs && receipt <= new Date(after).getTime(),
      },
      expected: {
        original: { ...original, receivedAt: undefined },
        fresh: true,
      },
    });
    const refusals = [
      {
        given: 'a body-supplied receipt',
        identity,
        body: {
          version: 1,
          roundParticipantId: host,
          frames: [{ ...original, receivedAt: new Date(nowMs).toISOString() }],
        },
        code: 'VALIDATION',
      },
      {
        given: 'an unbound guest seat',
        identity,
        body: { version: 1, roundParticipantId: guest, frames: [original] },
        code: 'AUTHORIZATION',
      },
      {
        given: 'a stale capture epoch',
        identity: { ...identity, epoch: identity.epoch + 1 },
        body: { version: 1, roundParticipantId: host, frames: [original] },
        code: 'CONFLICT',
      },
      {
        given: 'calibrated bounds after fresh PG time',
        identity,
        body: {
          version: 1,
          roundParticipantId: host,
          frames: [
            {
              ...original,
              sequence: 8,
              serverWindow: {
                before: new Date(nowMs + 60000).toISOString(),
                after: new Date(nowMs + 60010).toISOString(),
              },
            },
          ],
        },
        code: 'VALIDATION',
      },
    ] as const;
    for (const refusal of refusals)
      await assertRejects({
        given: refusal.given,
        should: 'refuse relay admission',
        actual: () => relay(refusal.identity, refusal.body),
        code: refusal.code,
      });
    assert({
      given: 'every refused relay',
      should: 'leave the stored batch and the guest key unchanged',
      actual: [
        (await f.redis.readBotActivity(f.roundId, host))?.frames[0]?.sequence,
        await f.redis.readBotActivity(f.roundId, guest),
      ],
      expected: [7, null],
    });
  });
});
