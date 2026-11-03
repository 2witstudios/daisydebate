import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomEvent } from 'livekit-client';
import { settle } from './adapters/livekit-room.test-support';
import { snapshot } from './media-fixtures.test-support';
import { mediaFailure, transientMediaFailure } from './media-failure';
import { publishing, sdkWorld } from './media-sdk-world.test-support';
import { connectionOf, statusOf } from './model/media-status';
import { testPolicy } from './model/media-state.test-support';

setupRitewayBun();

const never = new Promise<void>(() => undefined);

const cameraPhase = (w: Awaited<ReturnType<typeof sdkWorld>>) => {
  const { link } = w.runtime.state();
  return link.phase === 'live' ? link.sources.camera.phase : null;
};

test('a malformed reply says out of date as definite, and sets no timer', async () => {
  const w = await sdkWorld({
    replies: (read) => (read === 2 ? { version: 'not a state' } : publishing()),
  });
  await w.send({ kind: 'wake' });
  const after = [connectionOf(w.runtime.state()), w.timers(), w.admissions()];
  await w.send({ kind: 'view', roundViewVersion: 2 });
  assert({
    given: 'a reply that cannot parse on a live connection, then a newer view',
    should:
      'report it as not passing by itself, set no timer, and let the next answered read restore live',
    actual: [after, connectionOf(w.runtime.state())],
    expected: [['out-of-date', 0, 1], 'live'],
  });
  w.stop();
});

test('a conflict ends the connection; an unavailable state or a retired room rejoins by itself', async () => {
  const after = async (reply: () => unknown) => {
    const w = await sdkWorld({
      replies: (read) => (read === 1 ? publishing() : reply()),
    });
    await w.send({ kind: 'wake' });
    const outcome = [
      connectionOf(w.runtime.state()),
      w.refreshes(),
      w.timers(),
    ];
    w.stop();
    return outcome;
  };
  assert({
    given:
      'on a live read: a 409, a state of unavailable, and a session that moved to a fresh room',
    should:
      'wait for a person only on the 409; the others arm a rejoin, because admission decides authority',
    actual: [
      await after(() => {
        throw mediaFailure(409);
      }),
      await after(() => ({ ...snapshot, state: 'unavailable' })),
      await after(() => ({ ...snapshot, mediaRoomName: 'n'.repeat(24) })),
    ],
    expected: [
      ['unavailable', 1, 0],
      ['unavailable', 1, 1],
      ['unavailable', 1, 1],
    ],
  });
});

test('a publish that hangs on the first apply still reaches a way out', async () => {
  const w = await sdkWorld({
    replies: () => publishing('camera'),
    sdk: { publishGates: [never] },
  });
  const before = connectionOf(w.runtime.state());
  await w.advance(testPolicy.readBudgetMs);
  const after = {
    state: connectionOf(w.runtime.state()),
    retry: statusOf(w.runtime.state()).retry,
    waiting: w.timers(),
  };
  await w.advance(testPolicy.recoveryDelaysMs[0]!);
  assert({
    given: 'a first apply that never settles past the read budget',
    should: 'release it, offer Retry, and rejoin by itself on a new room',
    actual: {
      before,
      after,
      state: connectionOf(w.runtime.state()),
      rooms: w.rooms(),
    },
    expected: {
      before: 'connecting',
      after: { state: 'unavailable', retry: true, waiting: 1 },
      state: 'live',
      rooms: 2,
    },
  });
  w.stop();
});

test('reads behind a hung apply offer a way out without a reload (ISSUE-956)', async () => {
  const w = await sdkWorld({
    replies: (read) => (read === 1 ? publishing() : publishing('camera')),
    sdk: { publishGates: [never] },
  });
  await w.send({ kind: 'view', roundViewVersion: 2 });
  await w.advance(testPolicy.readBudgetMs);
  const status = statusOf(w.runtime.state());
  const state = connectionOf(w.runtime.state());
  w.runtime.dispatch({ type: 'retry-pressed' });
  await settle();
  assert({
    given: 'an SDK publish that never settles past the read budget',
    should:
      'stop claiming a check is running, offer Retry, and reach live on a new room',
    actual: {
      state,
      checking: status.message.includes('Checking'),
      retry: status.retry,
      after: connectionOf(w.runtime.state()),
      rooms: w.rooms(),
    },
    expected: {
      state: 'out-of-date',
      checking: false,
      retry: true,
      after: 'live',
      rooms: 2,
    },
  });
  w.stop();
});

test('a hung publish behind only a wake still ends in recovery, without a click', async () => {
  const w = await sdkWorld({
    replies: (read) => (read === 1 ? publishing() : publishing('camera')),
    sdk: { publishGates: [never] },
  });
  await w.send({ kind: 'wake' });
  await w.advance(testPolicy.readBudgetMs);
  const stale = connectionOf(w.runtime.state());
  await w.advance(testPolicy.recoveryDelaysMs[0]!);
  assert({
    given: 'a wake whose answer hangs in the SDK, and nobody pressing anything',
    should: 'say out of date at the budget, then rebuild on a new room',
    actual: [stale, connectionOf(w.runtime.state()), w.rooms()],
    expected: ['out-of-date', 'live', 2],
  });
  w.stop();
});

test('a failed media connection is an outage, so it rejoins by itself', async () => {
  const w = await sdkWorld({
    sdk: { connectGates: [Promise.reject(new Error('Could not connect'))] },
  });
  const after = [connectionOf(w.runtime.state()), w.timers()];
  await w.advance(testPolicy.recoveryDelaysMs[0]!);
  assert({
    given: 'a healthy admission whose LiveKit connection fails once',
    should: 'wait one paced delay and reach live without Retry',
    actual: [after, connectionOf(w.runtime.state()), w.admissions()],
    expected: [['unavailable', 1], 'live', 2],
  });
  w.stop();
});

test('a room that cannot open is a failed connection, not a stuck one', async () => {
  let throwing = true;
  const w = await sdkWorld({ openRoomThrows: () => throwing });
  const after = [
    connectionOf(w.runtime.state()),
    statusOf(w.runtime.state()).retry,
  ];
  throwing = false;
  await w.advance(testPolicy.recoveryDelaysMs[0]!);
  assert({
    given: 'an SDK that throws while opening the room, then recovers',
    should: 'say so with Retry, and rejoin by itself',
    actual: [after, connectionOf(w.runtime.state())],
    expected: [['unavailable', true], 'live'],
  });
  w.stop();
});

test('a LiveKit drop and its rejoin each refresh the Round view', async () => {
  const w = await sdkWorld({});
  const before = w.refreshes();
  const { link } = w.runtime.state();
  if (link.phase !== 'live') throw new Error('Not live');
  w.runtime.dispatch({ type: 'dropped', connection: link.connection });
  await settle();
  const dropped = w.refreshes() - before;
  await w.advance(testPolicy.recoveryDelaysMs[0]!);
  assert({
    given: 'a member whose media drops while the rest of the page is up',
    should: 'read the view on the drop and again on the new connection',
    actual: [dropped, w.refreshes() - before, connectionOf(w.runtime.state())],
    expected: [1, 2, 'live'],
  });
  w.stop();
});

test('a stop leaves no recovery behind', async () => {
  const w = await sdkWorld({
    admit: async () => {
      throw transientMediaFailure();
    },
  });
  const waiting = w.timers();
  w.stop();
  assert({
    given: 'an attempt waiting when the session ends',
    should: 'cancel its one timer',
    actual: [waiting, w.timers()],
    expected: [1, 0],
  });
});

test('with every session request held, nothing multiplies admissions', async () => {
  const held: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  let active = 0;
  let peak = 0;
  const w = await sdkWorld({
    admit: async () => {
      const request = Promise.withResolvers<unknown>();
      held.push(request);
      peak = Math.max(peak, ++active);
      try {
        return await request.promise;
      } finally {
        active--;
      }
    },
  });
  const nudge = async () => {
    for (let i = 0; i < 5; i++) w.runtime.dispatch({ type: 'browser-nudged' });
    await settle();
  };
  await nudge();
  const duringHold = held.length;
  const delays = testPolicy.requestRetryDelaysMs;
  // Each attempt of the first join hits its deadline in turn.
  for (const delay of delays) {
    held.at(-1)!.reject(transientMediaFailure());
    await settle();
    await w.advance(delay);
  }
  held.at(-1)!.reject(transientMediaFailure());
  await settle();
  const afterFirstJoin = held.length;
  await w.advance(testPolicy.recoveryDelaysMs[0]!);
  await nudge();
  const afterRejoin = held.length;
  held.at(-1)!.reject(transientMediaFailure());
  await settle();
  await nudge();
  const insideFloor = held.length;
  // The pace outgrows the floor, so an event can now move a waiting attempt up.
  for (const paced of testPolicy.recoveryDelaysMs.slice(1, 3)) {
    await w.advance(paced);
    held.at(-1)!.reject(transientMediaFailure());
    await settle();
  }
  await w.advance(testPolicy.eventFloorMs);
  const beforeFloor = held.length;
  await nudge();
  assert({
    given: 'admissions that hang until their deadline, under an event storm',
    should:
      'run one at a time, ignore events during one, and let an event move a waiting attempt up at most once per floor',
    actual: {
      duringHold,
      afterFirstJoin,
      afterRejoin,
      insideFloor,
      moved: held.length - beforeFloor,
      peak,
    },
    expected: {
      duringHold: 1,
      afterFirstJoin: delays.length + 1,
      afterRejoin: delays.length + 2,
      insideFloor: delays.length + 2,
      moved: 1,
      peak: 1,
    },
  });
  w.stop();
});

test('a read let finish cannot hold the fresh read past the young limit', async () => {
  const stalled = Promise.withResolvers<unknown>();
  const w = await sdkWorld({
    replies: (read) => (read === 1 ? publishing() : stalled.promise),
  });
  await w.send({ kind: 'wake' });
  await w.send({ kind: 'view', roundViewVersion: 2 });
  await w.advance(100);
  await w.send({ kind: 'view', roundViewVersion: 3 });
  const whileYoung = w.reads();
  await w.advance(2_000);
  assert({
    given: 'a burst whose last event lands on a young read that then stalls',
    should: 'leave it alone while young, then abort it and read fresh',
    actual: [whileYoung, w.reads()],
    expected: [3, 4],
  });
  w.stop();
});

test('storage refusing a forgotten device keeps the source named', async () => {
  const afterRetry = async (forgetFails: boolean) => {
    const w = await sdkWorld({
      forgetFails,
      checkedCamera: 'gone-camera',
      replies: () => publishing('camera', 'microphone'),
      sdk: { missingSource: 'camera' },
    });
    const before = cameraPhase(w);
    w.runtime.dispatch({ type: 'retry-pressed' });
    await settle();
    const outcome = [before, cameraPhase(w), connectionOf(w.runtime.state())];
    w.stop();
    return outcome;
  };
  assert({
    given: 'a checked camera gone, Retry, and storage refusing to forget it',
    should: 'keep naming the camera and keep the connection',
    actual: await afterRetry(true),
    expected: ['missing', 'missing', 'live'],
  });
});

test('a stuck camera beside a live microphone is named, and only a person rebuilds', async () => {
  const w = await sdkWorld({
    replies: (read) =>
      read === 1
        ? publishing('microphone')
        : publishing('camera', 'microphone'),
    sdk: { publishGates: [undefined, never] },
  });
  await w.send({ kind: 'wake' });
  await w.advance(testPolicy.readBudgetMs);
  for (const paced of testPolicy.recoveryDelaysMs) await w.advance(paced);
  const microphone = w.stub.captured.find(
    (track) => track.source === 'microphone',
  );
  const { message, retry } = statusOf(w.runtime.state());
  const before = {
    rooms: w.rooms(),
    microphoneEnded: microphone?.ended,
    named: message.includes('Your camera is not responding'),
    live: message.includes('Your microphone'),
    retry,
    state: connectionOf(w.runtime.state()),
  };
  w.runtime.dispatch({ type: 'retry-pressed' });
  await settle();
  assert({
    given:
      'a camera publish hung past every paced wake, then a person pressing Retry',
    should:
      'leave the microphone and room alone and name the camera, then rebuild on Retry',
    actual: { before, rooms: w.rooms() },
    expected: {
      before: {
        rooms: 1,
        microphoneEnded: false,
        named: true,
        live: true,
        retry: true,
        state: 'out-of-date',
      },
      rooms: 2,
    },
  });
  w.stop();
});

test('a stuck publish while receiving a peer is named, and only a person rebuilds', async () => {
  const w = await sdkWorld({
    replies: (read) => (read === 1 ? publishing() : publishing('camera')),
    sdk: { publishGates: [never] },
  });
  w.stub.subscribePeer('microphone');
  w.stub.fire(RoomEvent.TrackSubscribed);
  await settle();
  await w.send({ kind: 'wake' });
  await w.advance(testPolicy.readBudgetMs);
  for (const paced of testPolicy.recoveryDelaysMs) await w.advance(paced);
  const { message, retry } = statusOf(w.runtime.state());
  assert({
    given:
      'nothing published, a peer audible, and a publish hung past every wake',
    should:
      'keep the room and name the camera, because rebuilding costs the reception',
    actual: [
      w.rooms(),
      message.includes('Your camera is not responding'),
      retry,
    ],
    expected: [1, true, true],
  });
  w.stop();
});
