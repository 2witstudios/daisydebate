import { MemoryStorage } from '../../lib/storage.test-support';
import { createDeviceCheckController } from '../video/device-check-controller';
import {
  readCheckedDevices,
  rememberCheckedDevices,
  forgetCheckedDevices,
} from '../video/device-selection';
import { retryMissingDevices } from './media-status';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type Source,
} from './browser-transport';
import { createMediaController } from './media-controller';
import { mediaStatus, type SourceIllHealth } from './media-status';
import { admission, roundId, snapshot } from './media-controller.test-support';
import { events, sources, stubSdk } from './browser-transport.test-support';
setupRitewayBun();

const scenarios: readonly {
  readonly name: string;
  readonly grants: readonly Source[];
  readonly fail: readonly Source[];
  readonly expectedLocal: readonly Source[];
  readonly expectedMessage: string;
}[] = [
  {
    name: 'camera only fails',
    grants: ['camera', 'microphone'],
    fail: ['camera'],
    expectedLocal: ['microphone'],
    expectedMessage:
      'Your camera access is denied. Your microphone stays live.',
  },
  {
    name: 'microphone only fails',
    grants: ['camera', 'microphone'],
    fail: ['microphone'],
    expectedLocal: ['camera'],
    expectedMessage: 'Your microphone access is denied.',
  },
  {
    name: 'both local sources fail',
    grants: ['camera', 'microphone'],
    fail: ['camera', 'microphone'],
    expectedLocal: [],
    expectedMessage: 'Your camera and microphone access is denied.',
  },
  {
    name: 'receive only',
    grants: [],
    fail: ['camera', 'microphone'],
    expectedLocal: [],
    expectedMessage: 'Connected',
  },
];
for (const scenario of scenarios)
  test(`SDK capture composition: ${scenario.name}`, async () => {
    const stub = stubSdk({ settles: true });
    stub.subscribePeer('microphone');
    const captured: Source[] = [];
    let tracks: readonly MediaTrack[] = [];
    const failures: SourceIllHealth[] = [];
    const browser = createBrowserMediaTransport(
      {
        ...events,
        tracks: (value) => {
          tracks = value;
        },
        sourceFailed: (source, failure) => {
          failures.push([source, failure.kind]);
        },
      },
      {
        ...stub.sdk,
        capture: async (input) => {
          const source = input?.audio ? 'microphone' : 'camera';
          captured.push(source);
          if (scenario.fail.includes(source))
            throw { name: 'NotAllowedError', status: 403 };
          return stub.sdk.capture(input);
        },
      },
    );
    const grants = { ...admission.grants, publish: scenario.grants };
    const controller = createMediaController({
      roundId,
      recovery: { schedule: () => null, cancel: () => undefined, delaysMs: [] },
      api: {
        admit: async () => ({ ...admission, grants }),
        reconcile: async () => ({ ...snapshot, grants }),
      },
      transport: () => browser.transport,
      changed: () => undefined,
    });
    await controller.join();
    const local = sources(stub.published);
    const status = mediaStatus(controller.state(), [], {
      illHealth: failures,
      microphone: {
        granted: scenario.grants.includes('microphone'),
        published: local.includes('microphone'),
        muted: false,
      },
    });
    assert({
      given: `${scenario.name} with an independently subscribed remote microphone`,
      should:
        'preserve usable local sources and remote reception, report capture separately, and never capture without grants',
      actual: {
        local,
        remote: tracks
          .filter((track) => !track.local)
          .map((track) => track.source),
        truthful: status.message.includes(scenario.expectedMessage),
        attempted: captured.length > 0,
      },
      expected: {
        local: scenario.expectedLocal,
        remote: ['microphone'],
        truthful: true,
        attempted: scenario.grants.length > 0,
      },
    });
    controller.stop();
  });

test('explicit local Retry rereads grants and preserves the healthy subscribed transport', async () => {
  const stub = stubSdk({ settles: true });
  const remote = stub.subscribePeer('microphone');
  let refusing = true;
  let admissions = 0;
  let reads = 0;
  let connections = 0;
  let disconnections = 0;
  let tracks: readonly MediaTrack[] = [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      tracks: (value) => {
        tracks = value;
      },
    },
    {
      ...stub.sdk,
      capture: async (input) => {
        if (refusing) throw { name: 'NotReadableError' };
        return stub.sdk.capture(input);
      },
    },
  );
  const controller = createMediaController({
    roundId,
    recovery: { schedule: () => null, cancel: () => undefined },
    api: {
      admit: async () => {
        admissions++;
        return admission;
      },
      reconcile: async () => {
        reads++;
        return snapshot;
      },
    },
    transport: () => ({
      ...browser.transport,
      connect: async (grant) => {
        connections++;
        await browser.transport.connect(grant);
      },
      disconnect: async () => {
        disconnections++;
        await browser.transport.disconnect();
      },
    }),
    changed: () => undefined,
  });
  await controller.join();
  refusing = false;
  await controller.retry();
  assert({
    given:
      'both captures failing while reception is healthy, followed by explicit Retry after devices recover',
    should:
      'reread authoritative grants, recover both local publications and retain the exact remote track without readmission or reconnect',
    actual: {
      admissions,
      reads,
      connections,
      disconnections,
      local: sources(stub.published),
      sameRemote: tracks.some((track) => Object.is(track.track, remote)),
      connection: controller.state(),
    },
    expected: {
      admissions: 1,
      reads: 2,
      connections: 1,
      disconnections: 0,
      local: ['camera', 'microphone'],
      sameRemote: true,
      connection: 'live',
    },
  });
  controller.stop();
});

test('scoped missing-device Retry refreshes capture inputs while retaining healthy media', async () => {
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
  let missing: readonly Source[] = [];
  let tracks: readonly MediaTrack[] = [];
  let admissions = 0;
  const cameraInputs: unknown[] = [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => readCheckedDevices('room-a', host, 'actor-a'),
      missing: (source) => {
        missing = [...missing, source];
      },
      tracks: (value) => {
        tracks = value;
      },
    },
    {
      ...stub.sdk,
      capture: async (input) => {
        if (input?.video) cameraInputs.push(input.video);
        if (
          input?.video &&
          typeof input.video === 'object' &&
          input.video.deviceId
        )
          throw { name: 'NotFoundError' };
        return stub.sdk.capture(input);
      },
    },
  );
  const controller = createMediaController({
    roundId,
    recovery: { schedule: () => null, cancel: () => undefined },
    api: {
      admit: async () => {
        admissions++;
        return admission;
      },
      reconcile: async () => snapshot,
    },
    transport: () => browser.transport,
    changed: () => undefined,
  });
  await controller.join();
  const workingMicrophone = stub.captured.find(
    (track) => track.source === 'microphone',
  );
  missing = retryMissingDevices(
    'room-a',
    missing,
    'actor-a',
    (room, kinds, _storage, actor) =>
      forgetCheckedDevices(room, kinds, host, actor),
  );
  await controller.retry();
  assert({
    given:
      'actual scoped device checks, a missing checked camera, and explicit Retry through the production forget adapter',
    should:
      'capture the default camera, retain the checked microphone and remote track without a new admission',
    actual: {
      choice: readCheckedDevices('room-a', host, 'actor-a'),
      missing,
      local: sources(stub.published),
      cameraConstraints: cameraInputs.map(
        (value) => (value as MediaTrackConstraints).deviceId ?? null,
      ),
      microphoneRetained:
        stub.published.some((track) => Object.is(track, workingMicrophone)) &&
        stub.captured.filter((track) => track.source === 'microphone')
          .length === 1 &&
        !workingMicrophone?.ended,
      remoteRetained: tracks.some((track) => Object.is(track.track, remote)),
      admissions,
    },
    expected: {
      choice: {
        state: 'available',
        choices: { microphone: 'microphone-checked' },
      },
      missing: [],
      local: ['microphone', 'camera'],
      cameraConstraints: [{ exact: 'camera-checked' }, null],
      microphoneRetained: true,
      remoteRetained: true,
      admissions: 1,
    },
  });
  controller.stop();
});

test('a throwing scoped reader reports preference failure without default capture or losing reception', async () => {
  const stub = stubSdk({ settles: true });
  const remote = stub.subscribePeer('microphone');
  let tracks: readonly MediaTrack[] = [];
  const failures: SourceIllHealth[] = [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => {
        throw new Error('private storage detail');
      },
      sourceFailed: (source, failure) => {
        failures.push([source, failure.kind]);
      },
      tracks: (value) => {
        tracks = value;
      },
    },
    stub.sdk,
  );
  await browser.transport.apply({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['camera'] },
  });
  assert({
    given:
      'a requested camera and warm microphone whose scoped preference reader throws',
    should:
      'report unreadable preferences, capture neither default device and preserve the remote subscription',
    actual: {
      failures,
      captures: stub.captures.length,
      remoteRetained: tracks.some((track) => Object.is(track.track, remote)),
    },
    expected: {
      failures: [
        ['camera', 'preference-unreadable'],
        ['microphone', 'preference-unreadable'],
      ],
      captures: 0,
      remoteRetained: true,
    },
  });
  browser.transport.stopTracks();
});

test('capture constraints and checked attribution use one attempt snapshot', async () => {
  const stub = stubSdk({ settles: true });
  const started = Promise.withResolvers<void>();
  const fail = Promise.withResolvers<void>();
  const choices: { camera?: string; microphone?: string } = {
    camera: 'old-camera',
    microphone: 'same-microphone',
  };
  const cameraConstraints: unknown[] = [];
  const missing: Source[] = [];
  const failures: SourceIllHealth[] = [];
  let reads = 0;
  const browser = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => {
        reads++;
        return { state: 'available', choices };
      },
      missing: (source) => missing.push(source),
      sourceFailed: (source, failure) => failures.push([source, failure.kind]),
    },
    {
      ...stub.sdk,
      capture: async (input) => {
        if (input?.video) {
          cameraConstraints.push(input.video);
          if (cameraConstraints.length === 1) {
            started.resolve();
            await fail.promise;
            throw { name: 'NotFoundError' };
          }
        }
        return stub.sdk.capture(input);
      },
    },
  );
  const first = browser.transport.apply({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['camera'] },
  });
  await started.promise;
  delete choices.camera;
  fail.resolve();
  await first;
  await browser.transport.apply({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['camera'] },
  });
  assert({
    given:
      'a saved camera choice changing while the old checked capture is pending',
    should:
      'attribute that absence to the old immutable input and use default only on the next attempt',
    actual: {
      reads,
      missing,
      failures,
      exact: cameraConstraints.map(
        (value) => (value as MediaTrackConstraints).deviceId ?? null,
      ),
      local: sources(stub.published),
    },
    expected: {
      reads: 3,
      missing: ['camera'],
      failures: [],
      exact: [{ exact: 'old-camera' }, null],
      local: ['camera'],
    },
  });
  browser.transport.stopTracks();
});

test('disposal during a scoped read prevents capture and source updates into a successor', async () => {
  const stub = stubSdk({ settles: true });
  const failures: SourceIllHealth[] = [];
  let oldReads = 0;
  const old = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => {
        oldReads++;
        old.transport.stopTracks();
        throw new Error('private read failure');
      },
      sourceFailed: (source, failure) => failures.push([source, failure.kind]),
    },
    stub.sdk,
  );
  await old.transport.apply(snapshot);
  const active = createBrowserMediaTransport(
    {
      ...events,
      sourceFailed: (source, failure) => failures.push([source, failure.kind]),
    },
    stub.sdk,
  );
  await active.transport.apply(snapshot);
  assert({
    given:
      'an account/owner disposal during an old preference read followed by a new transport',
    should:
      'leave the retired reader inert and publish only the successor without stale preference failure',
    actual: {
      oldReads,
      failures,
      captures: stub.captures.length,
      local: sources(stub.published),
    },
    expected: {
      oldReads: 1,
      failures: [],
      captures: 2,
      local: ['camera', 'microphone'],
    },
  });
  active.transport.stopTracks();
});
