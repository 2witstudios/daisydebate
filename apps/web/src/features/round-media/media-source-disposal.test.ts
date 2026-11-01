import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createBrowserMediaTransport,
  type MediaTrack,
  type Source,
} from './browser-transport';
import { createMediaController } from './media-controller';
import { admission, snapshot, roundId } from './media-controller.test-support';
import { events, sources, stubSdk } from './browser-transport.test-support';
setupRitewayBun();

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
