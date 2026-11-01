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
