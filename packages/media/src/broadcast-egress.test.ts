import { assert, setupRitewayBun, test } from 'riteway/bun';
import { EgressStatus } from 'livekit-server-sdk';
import { createBroadcastEgress, egressFact } from './broadcast-egress';

setupRitewayBun();

const config = {
  url: 'https://livekit.test',
  apiKey: 'key',
  apiSecret: 'a-secret-long-enough-for-a-signing-key-000',
};

test('egressFact maps every status to what the lifecycle decides on', () => {
  const fact = (status: EgressStatus) => egressFact({ egressId: 'EG', status });
  assert({
    given: 'starting and active',
    should: 'report the running kinds',
    actual: [
      fact(EgressStatus.EGRESS_STARTING),
      fact(EgressStatus.EGRESS_ACTIVE),
    ],
    expected: [
      { kind: 'starting', id: 'EG' },
      { kind: 'active', id: 'EG' },
    ],
  });
  assert({
    given: 'ending and complete',
    should: 'report ending as still running, then complete',
    actual: [
      fact(EgressStatus.EGRESS_ENDING),
      fact(EgressStatus.EGRESS_COMPLETE),
    ],
    expected: [{ kind: 'active', id: 'EG' }, { kind: 'complete' }],
  });
  assert({
    given: 'failed, aborted and limit-reached',
    should: 'report failed, so the reconciler restarts it',
    actual: [
      fact(EgressStatus.EGRESS_FAILED),
      fact(EgressStatus.EGRESS_ABORTED),
      fact(EgressStatus.EGRESS_LIMIT_REACHED),
    ],
    expected: [
      { kind: 'failed', id: 'EG' },
      { kind: 'failed', id: 'EG' },
      { kind: 'failed', id: 'EG' },
    ],
  });
});

test('reading an Egress that LiveKit no longer lists is not treated as running', async () => {
  const egress = createBroadcastEgress({
    config,
    client: { listEgress: async () => [] } as never,
    rooms: {} as never,
  });
  assert({
    given: 'an id LiveKit does not list',
    should: 'report failed, so a dead job cannot look alive',
    actual: await egress.read('EG_gone'),
    expected: { kind: 'failed', id: 'EG_gone' },
  });
});

test('the observer is hidden, subscribe-only and revocable', async () => {
  const calls: unknown[][] = [];
  const egress = createBroadcastEgress({
    config,
    client: {} as never,
    rooms: {
      updateParticipant: async (...args: unknown[]) => {
        calls.push(args);
        return {} as never;
      },
    } as never,
  });
  await egress.revokeObserver('room');
  await egress.restoreObserver('room');
  const permission = (on: boolean) => ({
    canSubscribe: on,
    canPublish: false,
    canPublishData: false,
    hidden: true,
  });
  assert({
    given: 'a revoke and then a restore',
    should: 'change only the subscribe permission, never publish or visibility',
    actual: calls,
    expected: [
      ['room', 'stage-observer', undefined, permission(false)],
      ['room', 'stage-observer', undefined, permission(true)],
    ],
  });
  const token = await egress.observerToken('room', { canSubscribe: true });
  const claims = JSON.parse(atob(token.split('.')[1]!));
  assert({
    given: 'the minted observer token',
    should: 'join one room hidden, subscribe-only, never publishing',
    actual: {
      identity: claims.sub,
      room: claims.video.room,
      join: claims.video.roomJoin,
      subscribe: claims.video.canSubscribe,
      publish: claims.video.canPublish,
      data: claims.video.canPublishData,
      hidden: claims.video.hidden,
    },
    expected: {
      identity: 'stage-observer',
      room: 'room',
      join: true,
      subscribe: true,
      publish: false,
      data: false,
      hidden: true,
    },
  });
});

test('starting writes held media only to the hold prefix and waits for the page', async () => {
  const calls: unknown[][] = [];
  const egress = createBroadcastEgress({
    config,
    client: {
      startWebEgress: async (...args: unknown[]) => {
        calls.push(args);
        return { egressId: 'EG_new' };
      },
    } as never,
    rooms: {} as never,
  });
  const id = await egress.start({
    stageUrl: 'https://daisy.test/stage/x',
    holdPrefix: 'hold/b1/',
    segmentSeconds: 1,
  });
  const [url, output, options] = calls[0]! as [
    string,
    {
      segments: { filenamePrefix: string; segmentDuration: number };
      file: { filepath: string };
    },
    { awaitStartSignal: boolean },
  ];
  assert({
    given: 'a Broadcast start',
    should:
      'write a segmented hold and a file under its prefix, once the page signals',
    actual: {
      id,
      url,
      prefix: output.segments.filenamePrefix,
      seconds: output.segments.segmentDuration,
      file: output.file.filepath,
      awaitStartSignal: options.awaitStartSignal,
    },
    expected: {
      id: 'EG_new',
      url: 'https://daisy.test/stage/x',
      prefix: 'hold/b1/s',
      seconds: 1,
      file: 'hold/b1/full.mp4',
      awaitStartSignal: true,
    },
  });
});

test('a token minted during a private phase cannot subscribe on reconnect', async () => {
  const egress = createBroadcastEgress({
    config,
    client: {} as never,
    rooms: {} as never,
  });
  const token = await egress.observerToken('room', { canSubscribe: false });
  const { video } = JSON.parse(atob(token.split('.')[1]!));
  assert({
    given: 'a stage page reconnecting while the observer is revoked',
    should: 'join without subscribe, so reconnecting cannot bypass revocation',
    actual: [video.roomJoin, video.canSubscribe, video.canPublish],
    expected: [true, false, false],
  });
});
