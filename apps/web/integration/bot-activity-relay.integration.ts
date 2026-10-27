import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createLogger } from '@daisy/logger';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createBotListenerClient } from '@daisy/media/bot-listener';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotListenerHandlers } from '../src/features/round-bots/listener-handlers';
import {
  captureWorkerScope,
  leasedListenerSpeech,
  listenerActivityRelay,
  startCaptureSpeech,
  withMediaRound,
} from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('the listener lease relays a bound seat with fresh PG receipt and no body authority (ISSUE-764)', async () => {
  await withMediaRound(async (f) => {
    const { identity, segmentId } = await leasedListenerSpeech(f);
    const relay = listenerActivityRelay(f);
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
      segmentId,
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
          segmentId,
          frames: [{ ...original, receivedAt: new Date(nowMs).toISOString() }],
        },
        code: 'VALIDATION',
      },
      {
        given: 'an unbound guest seat',
        identity,
        body: {
          version: 1,
          roundParticipantId: guest,
          segmentId,
          frames: [original],
        },
        code: 'AUTHORIZATION',
      },
      {
        given: 'a stale listener epoch',
        identity: { ...identity, epoch: identity.epoch + 1 },
        body: {
          version: 1,
          roundParticipantId: host,
          segmentId,
          frames: [original],
        },
        code: 'CONFLICT',
      },
      {
        given: 'a segment that is not the current one',
        identity,
        body: {
          version: 1,
          roundParticipantId: host,
          segmentId: createId(),
          frames: [original],
        },
        code: 'CONFLICT',
      },
      {
        given: 'calibrated bounds after fresh PG time',
        identity,
        body: {
          version: 1,
          roundParticipantId: host,
          segmentId,
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
test('signed listener activity crosses the actual listener ingress into the expiring relay key (ISSUE-764)', async () => {
  await withMediaRound(async (f) => {
    const scope = await captureWorkerScope(f);
    const authentication = createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 7).toString('base64url'),
      now: Date.now,
    });
    const handlers = createBotListenerHandlers({
      logger: createLogger({ service: 'activity-proof', level: 'silent' }),
      authentication: () => authentication,
      listener: () => f.store,
      activity: listenerActivityRelay(f),
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: handlers.handle,
    });
    try {
      const client = createBotListenerClient({
        scope,
        url: `http://127.0.0.1:${server.port}`,
        authentication,
        fetch,
        nowMs: performance.now,
        deadlineSignal: () => AbortSignal.timeout(5000),
      });
      const { epoch } = await client.lease(15000);
      await startCaptureSpeech(f);
      const segmentId = (await client.read(epoch)).state.segment!.id;
      const [{ id: host }] =
        await f.sql`select p.id from round_participants p where p.round_id=${f.roundId} and p.actor_id=${f.host.actorId}`;
      const [{ now }] = await f.sql`select clock_timestamp() as now`;
      const nowMs = new Date(now).getTime();
      const frame = {
        trackId: 'host-track',
        sequence: 3,
        pcm: Array<number>(160).fill(-5),
        beforeMs: 12.5,
        afterMs: 22.5,
        serverWindow: {
          before: new Date(nowMs - 20).toISOString(),
          after: new Date(nowMs - 10).toISOString(),
        },
      };
      await client.activity({
        epoch,
        roundParticipantId: String(host),
        segmentId,
        frames: [frame],
      });
      const stored = await f.redis.readBotActivity(f.roundId, String(host));
      await assertRejects({
        given: 'a signed activity call under a superseded listener epoch',
        should: 'refuse relay through the real ingress',
        actual: () =>
          client.activity({
            epoch: epoch + 1,
            roundParticipantId: String(host),
            segmentId,
            frames: [{ ...frame, sequence: 4 }],
          }),
        code: 'CONFLICT',
      });
      assert({
        given: 'a signed listener activity batch for the leased bound seat',
        should:
          'store the original frame with a PG receipt and keep it after the stale-epoch refusal',
        actual: {
          frame: { ...stored!.frames[0]!, receivedAt: undefined },
          kept: (await f.redis.readBotActivity(f.roundId, String(host)))
            ?.frames[0]?.sequence,
        },
        expected: { frame: { ...frame, receivedAt: undefined }, kept: 3 },
      });
    } finally {
      await server.stop(true);
    }
  });
});
