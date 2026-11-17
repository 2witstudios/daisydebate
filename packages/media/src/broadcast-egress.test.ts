import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { EgressStatus, ServerError } from 'livekit-server-sdk';
import {
  broadcastEgressOnNodes,
  createBroadcastEgress,
  egressFact,
  stageCaptureId,
} from './broadcast-egress';

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
    expected: { kind: 'failed', id: 'EG_gone', reason: 'not_found' },
  });
});

test('an Egress LiveKit no longer knows settles; any other refusal still surfaces', async () => {
  const refusing = (error: Error) =>
    createBroadcastEgress({
      config,
      client: {
        listEgress: async () => {
          throw error;
        },
      } as never,
      rooms: {} as never,
    });
  const read = (error: Error) =>
    refusing(error)
      .read('EG_gone')
      .catch(() => 'thrown');
  assert({
    given: "LiveKit's not_found, by status or by code, for a long-ended Egress",
    should: 'report it failed and not found, so its attempt settles',
    actual: [
      await read(new ServerError('not_found', 'egress does not exist', 404)),
      await read(new ServerError('x', 'egress does not exist', 0, 'not_found')),
    ],
    expected: [
      { kind: 'failed', id: 'EG_gone', reason: 'not_found' },
      { kind: 'failed', id: 'EG_gone', reason: 'not_found' },
    ],
  });
  assert({
    given: 'an unavailable LiveKit, a refused credential or a network fault',
    should: 'throw, so nothing is settled on an unknown answer',
    actual: [
      await read(new ServerError('unavailable', 'down', 503)),
      await read(new ServerError('unauthenticated', 'no', 401)),
      await read(new Error('ECONNRESET')),
    ],
    expected: ['thrown', 'thrown', 'thrown'],
  });
});

test('stopping an Egress that is gone or already ended is done; other refusals surface', async () => {
  const stop = (error: Error) =>
    createBroadcastEgress({
      config,
      client: {
        stopEgress: async () => {
          throw error;
        },
      } as never,
      rooms: {} as never,
    })
      .stop('EG_old')
      .then(
        () => 'stopped',
        () => 'thrown',
      );
  assert({
    given: 'not_found, an ended Egress (failed_precondition), and an outage',
    should: 'treat the first two as stopped and throw on the outage',
    actual: [
      await stop(new ServerError('not_found', 'gone', 404)),
      await stop(
        new ServerError(
          'failed_precondition',
          'egress with status EGRESS_COMPLETE cannot be stopped',
          412,
        ),
      ),
      await stop(new ServerError('unavailable', 'down', 503)),
    ],
    expected: ['stopped', 'stopped', 'thrown'],
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

test('only this deployment’s stage URLs name a capture', () => {
  const origin = 'https://daisy.test';
  assert({
    given:
      'its own stage URL, a bare one, another deployment’s, and another path',
    should: 'name the capture only for its own',
    actual: [
      'https://daisy.test/stage/cap1?c=secret',
      'https://daisy.test/stage/',
      'https://other.test/stage/cap1?c=secret',
      'https://daisy.test/rounds/cap1',
    ].map((url) => stageCaptureId(url, origin)),
    expected: ['cap1', null, null, null],
  });
});

test('listing finds running stages, and nothing else', async () => {
  const listed: unknown[] = [];
  const egress = createBroadcastEgress({
    config,
    client: {
      listEgress: async (options: unknown) => {
        listed.push(options);
        return [
          {
            egressId: 'EG_stage',
            request: {
              case: 'web',
              value: { url: 'https://daisy.test/stage/cap1?c=s' },
            },
          },
          {
            egressId: 'EG_other',
            request: { case: 'web', value: { url: 'https://other.test/x' } },
          },
          {
            egressId: 'EG_room',
            request: { case: 'roomComposite', value: {} },
          },
        ];
      },
    } as never,
    rooms: {} as never,
  });
  assert({
    given: 'a stage Egress, a foreign web Egress and a room composite',
    should: 'ask for active ones and list only the stage',
    actual: [await egress.listStages('https://daisy.test'), listed],
    expected: [
      [{ egressId: 'EG_stage', captureId: 'cap1' }],
      [{ active: true }],
    ],
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

test('revoking an observer that is not in the room counts as revoked', async () => {
  const refuse = (status: number) => async () => {
    throw new ServerError('refused', 'refused', status);
  };
  const egress = (status: number) =>
    createBroadcastEgress({
      config,
      client: {} as never,
      rooms: { updateParticipant: refuse(status) } as never,
    });
  const outcome = (status: number) =>
    egress(status)
      .revokeObserver('room')
      .then(
        () => 'confirmed',
        () => 'unconfirmed',
      );
  assert({
    given:
      'a stopped Egress whose observer has left, and an unreachable LiveKit',
    should:
      'confirm the first, so the microphone can open, and leave the second unconfirmed',
    actual: [await outcome(404), await outcome(503)],
    expected: ['confirmed', 'unconfirmed'],
  });
});

describe('one Egress across the media nodes', () => {
  const egress = (name: string, calls: string[], fails = false) =>
    ({
      start: async () => {
        calls.push(`${name}:start`);
        if (fails) throw new Error('down');
        return name;
      },
      stop: async () => {
        calls.push(`${name}:stop`);
        if (fails) throw new Error('down');
      },
      read: async () => {
        calls.push(`${name}:read`);
        if (fails) throw new Error('down');
        return { kind: 'running', id: name };
      },
      listStages: async () => [],
      revokeObserver: async () => {
        calls.push(`${name}:revoke`);
        if (fails) throw new Error('down');
      },
      restoreObserver: async () => undefined,
      observerToken: async () => `${name}-token`,
    }) as never;
  const startInput = { stageUrl: 'u', holdPrefix: 'p', segmentSeconds: 4 };

  test('a dead node does not stop what is safe to repeat', async () => {
    const calls: string[] = [];
    const nodes = broadcastEgressOnNodes({
      egresses: [egress('a', calls, true), egress('b', calls)],
      order: () => [0, 1],
    });
    await nodes.revokeObserver('room');
    await nodes.stop('id');
    assert({
      given: 'the first node faulting',
      should: 'ask the next, and answer from it',
      actual: [[...calls], await nodes.read('id')],
      expected: [
        ['a:revoke', 'b:revoke', 'a:stop', 'b:stop'],
        { kind: 'running', id: 'b' },
      ],
    });
  });

  test('a start goes to the healthy node, once', async () => {
    const calls: string[] = [];
    const nodes = broadcastEgressOnNodes({
      egresses: [egress('a', calls), egress('b', calls)],
      order: () => [1, 0],
    });
    await nodes.start(startInput);
    assert({
      given: 'the second node first in health order',
      should: 'start there and nowhere else',
      actual: calls,
      expected: ['b:start'],
    });
  });

  test('a failed start is not repeated', async () => {
    const calls: string[] = [];
    const nodes = broadcastEgressOnNodes({
      egresses: [egress('a', calls, true), egress('b', calls)],
      order: () => [0, 1],
    });
    await nodes.start(startInput).catch(() => null);
    assert({
      given: 'a start that fails',
      should: 'not try another node, since the first may have begun',
      actual: calls,
      expected: ['a:start'],
    });
  });
});

test('unknown provider status remains unresolved rather than proving physical failure', () => {
  assert({
    given: 'an unrecognized vendor status for a known Egress identity',
    should: 'keep the physical job unresolved',
    actual: egressFact({ egressId: 'EG_unknown', status: 999 as EgressStatus }),
    expected: { kind: 'unresolved', id: 'EG_unknown' },
  });
});

test('exact-attempt recovery returns only matching deployment path/generation and never returns stage credentials', async () => {
  const entry = (egressId: string, url: string) => ({
    egressId,
    status: EgressStatus.EGRESS_ACTIVE,
    request: { case: 'web', value: { url } },
  });
  let observed = [
    entry('EG_current', 'https://daisy.test/stage/owned?c=private-secret&g=2'),
    entry('EG_old', 'https://daisy.test/stage/owned?c=old-secret&g=1'),
    entry('EG_foreign', 'https://foreign.test/stage/owned?g=2'),
    entry('EG_other', 'https://daisy.test/stage/other?g=2'),
  ];
  const adapter = createBroadcastEgress({
    config,
    client: { listEgress: async () => observed } as never,
    rooms: {} as never,
  });
  const read = () =>
    adapter.readStageAttempt({
      stageUrl: 'https://daisy.test/stage/owned?c=',
      generation: 2,
    });
  const found = await read();
  observed = [];
  const absent = await read();
  observed = [
    entry('EG_a', 'https://daisy.test/stage/owned?g=2'),
    entry('EG_b', 'https://daisy.test/stage/owned?g=2'),
  ];
  assert({
    given:
      'one exact observed attempt, a missing listing and an ambiguous duplicate listing',
    should:
      'recover only the exact observed identity and hold unknown cases without exposing credentials',
    actual: [found, absent, await read()],
    expected: [
      {
        kind: 'observed',
        egressId: 'EG_current',
        fact: { kind: 'active', id: 'EG_current' },
      },
      { kind: 'unresolved' },
      { kind: 'unresolved' },
    ],
  });
});
