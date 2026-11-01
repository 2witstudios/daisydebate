import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type Source,
} from './browser-transport';
import type { SourceIllHealth } from './media-status';
import { snapshot } from './media-controller.test-support';
import { events, stubSdk } from './browser-transport.test-support';
import { enterCameraTurn } from './media-warm.test-support';
setupRitewayBun();

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
