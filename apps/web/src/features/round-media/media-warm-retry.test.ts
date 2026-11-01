import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MemoryStorage } from '../../lib/storage.test-support';
import { createDeviceCheckController } from '../video/device-check-controller';
import {
  readCheckedDevices,
  rememberCheckedDevices,
  forgetCheckedDevices,
} from '../video/device-selection';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type Source,
} from './browser-transport';
import { createMediaController } from './media-controller';
import { retryMissingDevices, type SourceIllHealth } from './media-status';
import { admission, snapshot, roundId } from './media-controller.test-support';
import { events, sources, stubSdk } from './browser-transport.test-support';
setupRitewayBun();

const enterCameraTurn = async (failFirstWarm: boolean) => {
  const storage = new MemoryStorage();
  const host = () => storage;
  const checks = createDeviceCheckController({
    open: async (kind) => ({
      deviceId: `${kind}-checked`,
      confirm: async () => undefined,
      onLoss: () => () => undefined,
      stop: () => undefined,
    }),
  });
  await checks.check('camera');
  await checks.check('microphone');
  rememberCheckedDevices('room-a', checks.readSnapshot(), host, 'actor-a');
  checks.dispose('round-transition');
  const stub = stubSdk({ settles: true });
  const remote = stub.subscribePeer('microphone');
  const microphones: unknown[] = [];
  let missing: readonly Source[] = [];
  let failures: readonly SourceIllHealth[] = [];
  let tracks: readonly MediaTrack[] = [];
  let publish: readonly Source[] = ['camera'];
  let admissions = 0;
  const browser = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => readCheckedDevices('room-a', host, 'actor-a'),
      missing: (source) => {
        missing = [...missing, source];
      },
      sourceHealthy: (source) => {
        missing = missing.filter((held) => held !== source);
        failures = failures.filter(([held]) => held !== source);
      },
      sourceFailed: (source, failure) => {
        failures = [...failures, [source, failure.kind]];
      },
      tracks: (value) => {
        tracks = value;
      },
    },
    {
      ...stub.sdk,
      capture: async (input) => {
        if (input?.audio) {
          microphones.push(input.audio);
          if (failFirstWarm && microphones.length === 1)
            throw { name: 'NotFoundError' };
        }
        return stub.sdk.capture(input);
      },
    },
  );
  const current = () => ({
    ...snapshot,
    grants: { ...snapshot.grants, publish },
  });
  const controller = createMediaController({
    roundId,
    recovery: { schedule: () => null, cancel: () => undefined },
    api: {
      admit: async () => {
        admissions++;
        return { ...admission, grants: current().grants };
      },
      reconcile: async () => current(),
    },
    transport: () => browser.transport,
    changed: () => undefined,
  });
  await controller.join();
  return {
    controller,
    browser,
    stub,
    microphones,
    host,
    remote,
    missing: () => missing,
    failures: () => failures,
    tracks: () => tracks,
    admissions: () => admissions,
    grantMicrophone: () => {
      publish = ['camera', 'microphone'];
    },
    revokeMicrophone: () => {
      publish = ['camera'];
    },
    retryMissing: () => {
      missing = retryMissingDevices(
        'room-a',
        missing,
        'actor-a',
        (room, kinds, _storage, actor) =>
          forgetCheckedDevices(room, kinds, host, actor),
      );
      return controller.retry();
    },
  };
};

test('forgotten microphone choice cannot promote an obsolete recovered warm track', async () => {
  const flow = await enterCameraTurn(true);
  await flow.controller.reconcile();
  const recoveredWarm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const camera = flow.stub.published.find(
    (track) => track.source === 'camera',
  )!;
  const beforeRetry = flow.missing();
  await flow.retryMissing();
  flow.grantMicrophone();
  await flow.controller.reconcile();
  assert({
    given:
      'a checked microphone absent at first warm-up, recovered warm but still reported missing, then explicitly forgotten before its grant',
    should:
      'capture the requested default rather than publish the old warm choice, retaining camera, reception and one admission',
    actual: {
      beforeRetry,
      microphones: flow.microphones,
      oldWarmEnded: recoveredWarm.ended,
      cameraRetained: flow.stub.published.includes(camera) && !camera.ended,
      remoteRetained: flow
        .tracks()
        .some((track) => Object.is(track.track, flow.remote)),
      local: sources(flow.stub.published),
      admissions: flow.admissions(),
    },
    expected: {
      beforeRetry: ['microphone'],
      microphones: [
        { deviceId: { exact: 'microphone-checked' } },
        { deviceId: { exact: 'microphone-checked' } },
        true,
      ],
      oldWarmEnded: true,
      cameraRetained: true,
      remoteRetained: true,
      local: ['camera', 'microphone'],
      admissions: 1,
    },
  });
  flow.controller.stop();
});

test('an unchanged healthy warm microphone keeps its exact native track when granted', async () => {
  const flow = await enterCameraTurn(false);
  const warm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  flow.grantMicrophone();
  await flow.controller.reconcile();
  assert({
    given: 'healthy checked warm input whose scoped choice has not changed',
    should: 'reuse that track without another capture or admission',
    actual: {
      microphones: flow.microphones,
      reused: flow.stub.published.includes(warm),
      ended: warm.ended,
      admissions: flow.admissions(),
    },
    expected: {
      microphones: [{ deviceId: { exact: 'microphone-checked' } }],
      reused: true,
      ended: false,
      admissions: 1,
    },
  });
  flow.controller.stop();
});

test('an unreadable current preference cannot promote a warm microphone', async () => {
  const flow = await enterCameraTurn(false);
  const warm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const storage = flow.host();
  const read = storage.getItem.bind(storage);
  storage.getItem = () => {
    throw new Error('private storage fault');
  };
  flow.grantMicrophone();
  await flow.controller.reconcile();
  const blocked = {
    local: sources(flow.stub.published),
    failures: flow.failures(),
    warmEnded: warm.ended,
    microphones: flow.microphones.length,
  };
  storage.getItem = read;
  await flow.controller.retry();
  assert({
    given:
      'a warm checked microphone whose current scoped choice cannot be read before its grant, then a readable unchanged choice',
    should:
      'hold publication with an honest preference failure and reuse the same healthy warm input once verified',
    actual: {
      blocked,
      reused: flow.stub.published.includes(warm),
      microphones: flow.microphones.length,
      connection: flow.controller.state(),
    },
    expected: {
      blocked: {
        local: ['camera'],
        failures: [['microphone', 'preference-unreadable']],
        warmEnded: false,
        microphones: 1,
      },
      reused: true,
      microphones: 1,
      connection: 'live',
    },
  });
  flow.controller.stop();
});

for (const completion of ['resolve', 'reject'] as const)
  test(`ownership stop closes pending keep-warm unpublish before late ${completion}`, async () => {
    const stub = stubSdk({ settles: true });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const participant = stub.sdk.room().localParticipant;
    const unpublish = participant.unpublishTrack.bind(participant);
    participant.unpublishTrack = async (
      ...args: Parameters<typeof unpublish>
    ) => {
      entered.resolve();
      await release.promise;
      if (completion === 'reject')
        throw new Error('late private unpublish failure');
      return unpublish(...args);
    };
    let latest: readonly MediaTrack[] = [];
    const failures: SourceIllHealth[] = [];
    const observers = {
      ...events,
      tracks: (value: readonly MediaTrack[]) => {
        latest = value;
      },
      sourceFailed: (source: Source, failure: { kind: SourceIllHealth[1] }) => {
        failures.push([source, failure.kind]);
      },
    };
    const browser = createBrowserMediaTransport(observers, stub.sdk);
    await browser.transport.apply(snapshot);
    const mic = stub.captured.find((track) => track.source === 'microphone')!;
    let releases = 0;
    const stop = mic.stop.bind(mic);
    mic.stop = () => {
      releases++;
      stop();
    };
    const retiring = browser.transport.apply({
      ...snapshot,
      grants: { ...snapshot.grants, publish: ['camera'] },
    });
    await entered.promise;
    browser.transport.stopTracks();
    const stoppedImmediately = mic.ended;
    const successorSdk = stubSdk({ settles: true });
    const successorRemote = successorSdk.subscribePeer('microphone');
    const successor = createBrowserMediaTransport(observers, successorSdk.sdk);
    await successor.transport.apply(snapshot);
    release.resolve();
    await retiring;
    assert({
      given:
        'owner/account disposal while SDK unpublish is stalled between published and warm ownership',
      should:
        'stop the held microphone synchronously and never install it after the stale SDK completion',
      actual: [
        stoppedImmediately,
        mic.ended,
        stub.captured.every((track) => track.ended),
        releases,
        failures,
        latest.some((track) => Object.is(track.track, successorRemote)),
        successorSdk.captured.every((track) => !track.ended),
      ],
      expected: [true, true, true, 1, [], true, true],
    });
    successor.transport.stopTracks();
  });

test('unpublish rejection releases only its uncertain source and leaves the settle queue usable', async () => {
  const flow = await enterCameraTurn(false);
  flow.grantMicrophone();
  await flow.controller.reconcile();
  const mic = flow.stub.published.find(
    (track) => track.source === 'microphone',
  )!;
  const camera = flow.stub.published.find(
    (track) => track.source === 'camera',
  )!;
  let releases = 0;
  const stop = mic.stop.bind(mic);
  mic.stop = () => {
    releases++;
    stop();
  };
  const participant = flow.stub.sdk.room().localParticipant;
  const unpublish = participant.unpublishTrack.bind(participant);
  let refused = false;
  participant.unpublishTrack = async (
    ...args: Parameters<typeof unpublish>
  ) => {
    if (!refused) {
      refused = true;
      throw new Error('private SDK unpublish failure');
    }
    return unpublish(...args);
  };
  flow.revokeMicrophone();
  await flow.controller.reconcile();
  const failure = {
    state: flow.controller.state(),
    failures: flow.failures(),
    cameraLive: !camera.ended,
    remoteRetained: flow
      .tracks()
      .some((track) => Object.is(track.track, flow.remote)),
  };
  flow.grantMicrophone();
  await flow.controller.reconcile();
  assert({
    given:
      'a current mic unpublish rejected by the SDK followed by a new authoritative grant',
    should:
      'release the uncertain mic once, report its failure, preserve healthy paths and allow later settle work without readmission',
    actual: {
      failure,
      oldMicEnded: mic.ended,
      releases,
      state: flow.controller.state(),
      cameraRetained: flow.stub.published.includes(camera) && !camera.ended,
      admissions: flow.admissions(),
    },
    expected: {
      failure: {
        state: 'live',
        failures: [['microphone', 'failure']],
        cameraLive: true,
        remoteRetained: true,
      },
      oldMicEnded: true,
      releases: 1,
      state: 'live',
      cameraRetained: true,
      admissions: 1,
    },
  });
  flow.controller.stop();
});

test('synchronous disposal inside SDK unpublish releases each owned resource once', async () => {
  const stub = stubSdk({ settles: true });
  const participant = stub.sdk.room().localParticipant;
  const unpublish = participant.unpublishTrack.bind(participant);
  const browser = createBrowserMediaTransport(events, stub.sdk);
  await browser.transport.apply(snapshot);
  const releases = new Map<string, number>();
  for (const track of stub.captured) {
    const stop = track.stop.bind(track);
    track.stop = () => {
      releases.set(track.source, (releases.get(track.source) ?? 0) + 1);
      stop();
    };
  }
  participant.unpublishTrack = async (
    ...args: Parameters<typeof unpublish>
  ) => {
    browser.transport.stopTracks();
    return unpublish(...args);
  };
  await browser.transport.apply({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['camera'] },
  });
  assert({
    given: 'SDK unpublish synchronously invoking owner disposal',
    should:
      'find one authoritative owner per resource with no late warm installation or extra capture',
    actual: {
      releases: Object.fromEntries(releases),
      captures: stub.captured.length,
      ended: stub.captured.every((track) => track.ended),
    },
    expected: {
      releases: { camera: 1, microphone: 1 },
      captures: 2,
      ended: true,
    },
  });
});

test('stale controller cleanup cannot clear the successor track snapshot after delayed unpublish', async () => {
  const first = stubSdk({ settles: true });
  const second = stubSdk({ settles: true });
  const remote = second.subscribePeer('microphone');
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const participant = first.sdk.room().localParticipant;
  const unpublish = participant.unpublishTrack.bind(participant);
  participant.unpublishTrack = async (
    ...args: Parameters<typeof unpublish>
  ) => {
    entered.resolve();
    await finish.promise;
    return unpublish(...args);
  };
  let latest: readonly MediaTrack[] = [];
  let publish: readonly Source[] = ['camera', 'microphone'];
  let transports = 0;
  const controller = createMediaController({
    roundId,
    recovery: { schedule: () => null, cancel: () => undefined },
    api: {
      admit: async () => ({
        ...admission,
        grants: { ...admission.grants, publish },
      }),
      reconcile: async () => ({
        ...snapshot,
        grants: { ...snapshot.grants, publish },
      }),
    },
    transport: () =>
      createBrowserMediaTransport(
        {
          ...events,
          tracks: (value) => {
            latest = value;
          },
        },
        (transports++ === 0 ? first : second).sdk,
      ).transport,
    changed: () => undefined,
  });
  await controller.join();
  publish = ['camera'];
  const retiring = controller.reconcile();
  await entered.promise;
  await controller.reconnect();
  finish.resolve();
  await retiring;
  assert({
    given:
      'a fresh admission/transport completing before the retired controller flight finishes unpublishing',
    should:
      'leave the successor UI tracks and capture intact when stale cleanup runs again',
    actual: {
      remoteRetained: latest.some((track) => Object.is(track.track, remote)),
      oldEnded: first.captured.every((track) => track.ended),
      newLive: second.captured.every((track) => !track.ended),
      state: controller.state(),
    },
    expected: {
      remoteRetained: true,
      oldEnded: true,
      newLive: true,
      state: 'live',
    },
  });
  controller.stop();
});

test('owner stop sees a warm source across the asynchronous promotion boundary', async () => {
  const stub = stubSdk({ settles: true });
  let disposeOnRead = false;
  let stoppedImmediately = false;
  const browser = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => {
        if (disposeOnRead)
          queueMicrotask(() => {
            browser.transport.stopTracks();
            stoppedImmediately = mic.ended;
          });
        return { state: 'available', choices: {} };
      },
    },
    stub.sdk,
  );
  await browser.transport.apply({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['camera'] },
  });
  const mic = stub.captured.find((track) => track.source === 'microphone')!;
  disposeOnRead = true;
  await browser.transport.apply(snapshot);
  assert({
    given:
      'owner disposal between verified warm reuse and its publication continuation',
    should:
      'retain reachable ownership so the already captured microphone stops synchronously',
    actual: [stoppedImmediately, mic.ended],
    expected: [true, true],
  });
});

test('a stale mute rejection cannot remove or report failure on a replacement microphone', async () => {
  const flow = await enterCameraTurn(true);
  await flow.controller.reconcile();
  const oldWarm = flow.stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const gate = Promise.withResolvers<void>();
  oldWarm.mute = async () => {
    await gate.promise;
    throw new Error('old private mute failure');
  };
  const pending = flow.browser.setMicrophoneMuted(true);
  await flow.retryMissing();
  flow.grantMicrophone();
  await flow.controller.reconcile();
  const replacement = flow.stub.captured
    .filter((track) => track.source === 'microphone')
    .at(-1)!;
  gate.reject(new Error('old private mute failure'));
  let rejected = false;
  await pending.catch(() => {
    rejected = true;
  });
  const active = {
    rejected,
    replaced: replacement !== oldWarm,
    failures: flow.failures(),
    newLive: !replacement.ended,
  };
  flow.controller.stop();
  assert({
    given:
      'an old warm-source mute rejecting after explicit default Retry and a fresh source grant',
    should:
      'leave the replacement owned and healthy, report no stale failure and release it on final stop',
    actual: { active, replacementEnded: replacement.ended },
    expected: {
      active: { rejected: true, replaced: true, failures: [], newLive: true },
      replacementEnded: true,
    },
  });
});

test('disposal during prepublication mute cannot start a late SDK publication', async () => {
  const stub = stubSdk({ settles: true });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const sdk = {
    ...stub.sdk,
    capture: async (input: Parameters<typeof stub.sdk.capture>[0]) => {
      const tracks = await stub.sdk.capture(input);
      const captured = stub.captured.at(-1)!;
      if (input?.audio)
        captured.mute = async () => {
          entered.resolve();
          await release.promise;
          return captured;
        };
      return tracks;
    },
  };
  const browser = createBrowserMediaTransport(
    { ...events, microphoneMuted: true },
    sdk,
  );
  const joining = browser.transport.apply(snapshot);
  await entered.promise;
  browser.transport.stopTracks();
  release.resolve();
  await joining;
  assert({
    given: 'owner disposal while the initial microphone mute is awaited',
    should:
      'release the captured input and never start its SDK publication after disposal',
    actual: {
      published: sources(stub.published),
      ended: stub.captured.every((track) => track.ended),
    },
    expected: { published: ['camera'], ended: true },
  });
});
