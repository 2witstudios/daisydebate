import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ConnectionError,
  DisconnectReason,
  RoomEvent,
  Track,
  TrackEvent,
} from 'livekit-client';
import type { ObservedPeer as RemotePeer } from '../model/media-state';
import { createBrowserMediaTransport } from '../media-harness.test-support';
import {
  events,
  publish,
  settle,
  sources,
  stubSdk,
} from './livekit-room.test-support';
import { admission } from '../media-fixtures.test-support';
import { createLiveKitRoom, resumeDelayMs } from './livekit-room';
import type { RoomEvent as MediaRoomEvent } from '../model/media-events';
setupRitewayBun();

/** A transport whose shared track list records each length it is sent. */
const countingTrackList = () => {
  const stub = stubSdk();
  const emitted: number[] = [];
  const { transport } = createBrowserMediaTransport(
    { ...events, tracks: (tracks) => emitted.push(tracks.length) },
    stub.sdk,
  );
  return { stub, emitted, transport };
};

test('a terminal stop ends a camera captured while its publish is in flight', async () => {
  const stub = stubSdk();
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  void transport.apply(publish(['camera']));
  await settle();
  transport.stopTracks();
  assert({
    given:
      'a camera captured whose publish has not settled, then a terminal stop',
    should:
      'end that track by the transport’s own stop, not LiveKit’s (VIDEO-2.1-r4)',
    actual: stub.captured.filter((track) => !track.ended).length,
    expected: 0,
  });
});

test('a track captured after a terminal stop is ended at once', async () => {
  const gate = Promise.withResolvers<void>();
  const stub = stubSdk({ captureGates: [gate.promise] });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  void transport.apply(publish(['camera']));
  await settle();
  transport.stopTracks();
  gate.resolve();
  await settle();
  assert({
    given: 'a camera capture that resolves only after the terminal stop',
    should: 'end the late track instead of keeping it',
    actual: stub.captured.filter((track) => !track.ended).length,
    expected: 0,
  });
});

test('an unexpected disconnect ends every captured track', async () => {
  const stub = stubSdk();
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.connect(admission);
  void transport.apply(publish(['camera']));
  await settle();
  stub.fire(RoomEvent.Disconnected);
  assert({
    given: 'a captured camera when the room disconnects on its own',
    should: 'end it, since LiveKit skips a room already disconnected',
    actual: stub.captured.filter((track) => !track.ended).length,
    expected: 0,
  });
});

test('a blip keeps every captured track; only a drop ends them', async () => {
  const stub = stubSdk();
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.connect(admission);
  void transport.apply(publish(['camera']));
  await settle();
  stub.fire(RoomEvent.SignalReconnecting);
  stub.fire(RoomEvent.Reconnected);
  stub.fire(RoomEvent.Reconnecting);
  stub.fire(RoomEvent.Reconnected);
  assert({
    given: 'the SDK resuming after a signal blip, then a full restart',
    should: 'leave the captured camera running',
    actual: stub.captured.filter((track) => track.ended).length,
    expected: 0,
  });
});

test('a connection tries to resume only inside its short budget', () => {
  assert({
    given: 'each retry inside the budget, and one past it',
    should: 'retry quickly, then give up to the one recovery loop',
    actual: [
      resumeDelayMs({ retryCount: 0, elapsedMs: 0 }),
      resumeDelayMs({ retryCount: 1, elapsedMs: 10 }),
      resumeDelayMs({ retryCount: 9, elapsedMs: 4_999 }),
      resumeDelayMs({ retryCount: 2, elapsedMs: 5_000 }),
    ],
    expected: [0, 300, 1_500, null],
  });
});

test('a microphone opens when LiveKit allows it, before the reconcile reply', async () => {
  const stub = stubSdk({ settles: true });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.apply(publish(['camera']));
  stub.permit([Track.Source.Camera, Track.Source.Microphone]);
  await settle();
  assert({
    given:
      'a debater publishing only the camera whose LiveKit permission then opens the microphone',
    should: 'publish the microphone without waiting for a reply (ISSUE-572)',
    actual: sources(stub.published),
    expected: ['camera', 'microphone'],
  });
  await transport.apply(publish(['camera']));
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given: 'a reply computed before the opening, then the reply that grants it',
    should: 'neither unpublish nor publish the microphone a second time',
    actual: {
      published: sources(stub.published),
      microphones: stub.captured.filter((t) => t.source === 'microphone')
        .length,
    },
    expected: { published: ['camera', 'microphone'], microphones: 1 },
  });
  stub.permit([Track.Source.Camera]);
  await settle();
  assert({
    given: 'LiveKit closing the microphone when the turn ends',
    should: 'unpublish it while the camera stays',
    actual: sources(stub.published),
    expected: ['camera'],
  });
});

test("a debater's microphone waits warm and is the one its grant publishes", async () => {
  const stub = stubSdk({ settles: true });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.apply(publish(['camera']));
  const [warm] = stub.captured.filter((t) => t.source === 'microphone');
  assert({
    given: 'a debater seat granted only its camera',
    should: 'hold its microphone captured, unpublished and live',
    actual: {
      published: sources(stub.published),
      warm: warm ? !warm.ended : 'none',
    },
    expected: { published: ['camera'], warm: true },
  });
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given: 'the microphone grant',
    should: 'publish the held microphone, opening no second one',
    actual: {
      published: stub.published.includes(warm!),
      microphones: stub.captured.filter((t) => t.source === 'microphone')
        .length,
    },
    expected: { published: true, microphones: 1 },
  });
  await transport.apply(publish(['camera']));
  assert({
    given: 'the end of that turn',
    should: 'unpublish the microphone and keep it warm for the next',
    actual: { published: sources(stub.published), live: !warm!.ended },
    expected: { published: ['camera'], live: true },
  });
  transport.stopTracks();
  assert({
    given: 'a terminal stop',
    should: 'end the warm microphone',
    actual: warm!.ended,
    expected: true,
  });
});

test('a seat that stops publishing releases its warm microphone', async () => {
  const stub = stubSdk({ settles: true });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.apply(publish([]));
  assert({
    given: 'a seat that publishes nothing, such as a judge',
    should: 'open no microphone',
    actual: stub.captured.length,
    expected: 0,
  });
  await transport.apply(publish(['camera']));
  await transport.apply(publish([]));
  assert({
    given: 'a debater whose grants close entirely, as at the end of the Round',
    should: 'end every track, the warm microphone included',
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [
      ['camera', true],
      ['microphone', true],
    ],
  });
});

test('a terminal stop ends the microphone whose warm capture is still in flight', async () => {
  const warmGate = Promise.withResolvers<void>();
  const stub = stubSdk({
    settles: true,
    captureGates: [undefined, warmGate.promise],
  });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  const settled = transport.apply(publish(['camera']));
  await settle();
  transport.stopTracks();
  warmGate.resolve();
  await settle();
  await settled;
  assert({
    given:
      "a terminal stop while warmMicrophone's capture of the microphone is pending",
    should:
      'end the track that capture returns, never keep it warm (ISSUE-574)',
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [
      ['camera', true],
      ['microphone', true],
    ],
  });
});

test('a terminal stop ends the kept microphone whose unpublish is still in flight', async () => {
  const unpublishGate = Promise.withResolvers<void>();
  const stub = stubSdk({ settles: true, unpublishGate: unpublishGate.promise });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.apply(publish(['camera', 'microphone']));
  const retiring = transport.apply(publish(['camera']));
  await settle();
  transport.stopTracks();
  unpublishGate.resolve();
  await settle();
  await retiring;
  assert({
    given:
      "a terminal stop while retire's keep-warm unpublishTrack(track, false) is pending",
    should: 'end the kept microphone instead of holding it warm (ISSUE-574)',
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [
      ['camera', true],
      ['microphone', true],
    ],
  });
});
const mutedMicrophone = async () => {
  const stub = stubSdk({ settles: true });
  const browser = createBrowserMediaTransport(
    { ...events, microphoneMuted: true },
    stub.sdk,
  );
  await browser.transport.apply(publish(['camera', 'microphone']));
  const microphone = stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  return { stub, browser, microphone };
};

test('POI local mute changes audio without changing server publish grants', async () => {
  const { stub, browser, microphone } = await mutedMicrophone();
  const initiallyMuted = microphone.muted;
  await browser.setMicrophoneMuted(false);
  const unmuted = microphone.muted;
  await browser.transport.apply(publish(['camera']));
  await browser.setMicrophoneMuted(false);
  assert({
    given:
      'a POI microphone, an explicit unmute, and then a revoked speaking grant',
    should:
      'start muted, permit unmuting and never republish against server authority',
    actual: [initiallyMuted, unmuted, sources(stub.published)],
    expected: [true, false, ['camera']],
  });
  browser.transport.stopTracks();
});

test('a failed local microphone change stops only that source and preserves reception', async () => {
  const { stub, browser, microphone } = await mutedMicrophone();
  microphone.unmute = async () => {
    throw new Error('Device disconnected');
  };
  stub.subscribePeer('microphone');
  let failed = false;
  try {
    await browser.setMicrophoneMuted(false);
  } catch {
    failed = true;
  }
  assert({
    given: 'unmuting fails with an unknown track outcome',
    should: 'stop the unknown microphone while preserving the working camera',
    actual: [
      failed,
      microphone.ended,
      stub.captured.find((track) => track.source === 'camera')!.ended,
    ],
    expected: [true, true, false],
  });
});

test('a muted publication remains observable as present without claiming an open microphone', async () => {
  const stub = stubSdk({ settles: true });
  const room = stub.sdk.room();
  const published = {
    source: Track.Source.Microphone,
    isMuted: true,
    track: { sid: 'muted-mic' },
  };
  room.localParticipant.trackPublications.set(
    'muted-mic',
    published as unknown as import('livekit-client').LocalTrackPublication,
  );
  let observed: readonly import('../media-harness.test-support').MediaTrack[] =
    [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      tracks: (tracks) => {
        observed = tracks;
      },
    },
    stub.sdk,
  );
  await browser.transport.apply(publish([]));
  assert({
    given: 'an actual SDK microphone publication whose track is muted',
    should:
      'retain explicit present-and-muted evidence for its caller, distinct from no captured publication',
    actual: observed.map((track) => ({
      source: track.source,
      muted: track.muted,
    })),
    expected: [{ source: 'microphone', muted: true }],
  });
  browser.transport.stopTracks();
});

test('browser playback refusal and recovery are reported from actual SDK state', async () => {
  const stub = stubSdk();
  let allowed = false;
  Object.defineProperty(stub.sdk.room(), 'canPlaybackAudio', {
    get: () => allowed,
  });
  const changes: boolean[] = [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      playbackChanged: (value) => {
        changes.push(value);
      },
    },
    stub.sdk,
  );
  await browser.transport.connect(admission);
  stub.fire(RoomEvent.AudioPlaybackStatusChanged);
  allowed = true;
  await settle();
  stub.fire(RoomEvent.AudioPlaybackStatusChanged);
  assert({
    given: 'SDK autoplay refusal followed by successful user-enabled playback',
    should:
      'report blocked then permitted playback without conflating it with capture permission or peer audibility',
    actual: changes,
    expected: [false, true],
  });
  browser.transport.stopTracks();
});

test('a stopped transport cannot send late SDK health or playback into a newer lifetime', () => {
  const stub = stubSdk();
  const updates: string[] = [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      tracks: () => updates.push('tracks'),
      invalidated: () => updates.push('refresh'),
      playbackChanged: () => updates.push('playback'),
    },
    stub.sdk,
  );
  browser.transport.stopTracks();
  void browser.transport.disconnect();
  updates.length = 0;
  stub.fire(RoomEvent.TrackSubscribed);
  stub.fire(RoomEvent.Connected);
  stub.fire(RoomEvent.AudioPlaybackStatusChanged);
  assert({
    given:
      'retired media followed by late SDK subscription, connection and playback callbacks',
    should:
      'leave the replacement lifetime’s evidence and refresh requests untouched',
    actual: updates,
    expected: [],
  });
});

test('a capture failure settling after stop belongs to the retired source only', async () => {
  const stub = stubSdk();
  const capture =
    Promise.withResolvers<Awaited<ReturnType<typeof stub.sdk.capture>>>();
  const failures: string[] = [];
  const browser = createBrowserMediaTransport(
    { ...events, sourceFailed: (source) => failures.push(source) },
    { room: stub.sdk.room, capture: () => capture.promise },
  );
  const applying = browser.transport.apply(publish(['camera'])).then(
    () => 'resolved',
    () => 'rejected',
  );
  await settle();
  browser.transport.stopTracks();
  capture.reject(
    new DOMException('Controlled late failure', 'NotReadableError'),
  );
  assert({
    given: 'pending capture rejected after owner stepdown/terminal stop',
    should:
      'settle retirement without reporting a failure against the new source lifetime',
    actual: [await applying, failures],
    expected: ['resolved', []],
  });
});

test('explicit playback completion reports only through its current transport owner', async () => {
  const active = stubSdk();
  Object.defineProperty(active.sdk.room(), 'canPlaybackAudio', {
    get: () => true,
  });
  const current: boolean[] = [];
  const browser = createBrowserMediaTransport(
    { ...events, playbackChanged: (value) => current.push(value) },
    active.sdk,
  );
  await browser.transport.connect(admission);
  await browser.startAudio();
  browser.transport.stopTracks();
  const retired = stubSdk();
  const gate = Promise.withResolvers<void>();
  Object.defineProperty(retired.sdk.room(), 'canPlaybackAudio', {
    get: () => true,
  });
  Object.defineProperty(retired.sdk.room(), 'startAudio', {
    value: () => gate.promise,
  });
  const stale: boolean[] = [];
  const old = createBrowserMediaTransport(
    { ...events, playbackChanged: (value) => stale.push(value) },
    retired.sdk,
  );
  const pending = old.startAudio();
  old.transport.stopTracks();
  gate.resolve();
  await pending;
  assert({
    given:
      'successful Enable sound and an older Enable sound settling after retirement',
    should:
      'publish the active playback result only, never overwrite a replacement from a retired promise',
    actual: [current, stale],
    expected: [[], []],
  });
});

test('explicit microphone choices commit only after success in the current source lifetime', async () => {
  const stub = stubSdk({ settles: true });
  const committed: boolean[] = [];
  const browser = createBrowserMediaTransport(
    {
      ...events,
      microphoneMuted: true,
      microphoneChanged: (value) => committed.push(value),
    },
    stub.sdk,
  );
  await browser.transport.apply(publish(['camera', 'microphone']));
  await browser.setMicrophoneMuted(false);
  const microphone = stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  const gate = Promise.withResolvers<void>();
  microphone.mute = async () => {
    await gate.promise;
    return microphone;
  };
  const pending = browser.setMicrophoneMuted(true);
  browser.transport.stopTracks();
  gate.resolve();
  await pending;
  assert({
    given:
      'a successful explicit unmute then a mute whose SDK promise settles after stepdown',
    should: 'commit the first choice but never the retired choice',
    actual: committed,
    expected: [false],
  });
});

test('remote presence follows the room, not the grant or a subscription', async () => {
  const stub = stubSdk({ settles: true });
  const seen: (readonly RemotePeer[])[] = [];
  const { transport } = createBrowserMediaTransport(
    { ...events, remotePeers: (peers) => seen.push(peers) },
    stub.sdk,
  );
  await transport.connect(admission);
  stub.joinPeer([{ source: Track.Source.Microphone, track: undefined }]);
  stub.fire(RoomEvent.ParticipantConnected);
  stub.leavePeer();
  stub.fire(RoomEvent.ParticipantDisconnected);
  assert({
    given:
      'a peer joining with an unsubscribed microphone publication, then dropping',
    should: 'report that publication while present and no peer once gone',
    actual: seen.slice(-2),
    expected: [[{ identity: 'peer', microphonePublished: true }], []],
  });
  stub.joinPeer([]);
  stub.fire(RoomEvent.TrackPublished);
  assert({
    given: 'a connected peer with no microphone publication',
    should: 'report presence without a publication',
    actual: seen.at(-1),
    expected: [{ identity: 'peer', microphonePublished: false }],
  });
  transport.stopTracks();
  assert({
    given: 'this transport stopping',
    should: 'claim no remote peer it can no longer observe',
    actual: seen.at(-1),
    expected: [],
  });
});

test('a failed publish names its source, and only Retry or a new grant tries again', async () => {
  const stub = stubSdk({ settles: true, failFirstPublish: true });
  const failed: string[] = [];
  const { transport } = createBrowserMediaTransport(
    { ...events, sourceFailed: (source) => void failed.push(source) },
    stub.sdk,
  );
  await transport.apply(publish(['camera']));
  await transport.apply(publish(['camera']));
  const beforeRetry = sources(stub.published);
  transport.allowRecapture();
  await transport.apply(publish(['camera']));
  assert({
    given: 'an apply whose publish fails, a later apply, then a Retry',
    should: 'report the source once, wait, and publish after the Retry',
    actual: { failed, beforeRetry, after: sources(stub.published) },
    expected: { failed: ['camera'], beforeRetry: [], after: ['camera'] },
  });
});

test('only the first stop empties the shared track list', async () => {
  const { emitted, transport } = countingTrackList();
  await transport.connect(admission);
  emitted.length = 0;
  transport.stopTracks();
  transport.stopTracks();
  assert({
    given: 'a released transport stopped again after a successor owns the list',
    should: 'emit the empty list once',
    actual: emitted,
    expected: [0],
  });
});

test('a failed unpublish of a kept microphone stops it and names it, in any pass', async () => {
  const outcome = async (
    close: (
      stub: ReturnType<typeof stubSdk>,
      transport: ReturnType<typeof createBrowserMediaTransport>['transport'],
    ) => Promise<void>,
  ) => {
    const stub = stubSdk({ settles: true, failFirstUnpublish: true });
    const failed: string[] = [];
    const { transport } = createBrowserMediaTransport(
      { ...events, sourceFailed: (source) => void failed.push(source) },
      stub.sdk,
    );
    await transport.apply(publish(['camera', 'microphone']));
    await settle();
    await close(stub, transport);
    await settle();
    return {
      failed,
      capturing: stub.captured.some(
        (track) => track.source === 'microphone' && !track.ended,
      ),
    };
  };
  const expected = { failed: ['microphone'], capturing: false };
  assert({
    given: 'the floor closing and the unpublish of the kept microphone failing',
    should: 'report that source and leave no microphone capturing',
    actual: await outcome(async (_stub, transport) => {
      await transport.apply(publish(['camera']));
    }),
    expected,
  });
  assert({
    given: 'the same failure in a pass nobody was waiting on',
    should: 'report it the same way',
    actual: await outcome(async (stub) => {
      stub.permit([Track.Source.Camera]);
    }),
    expected,
  });
});

test('a released room cannot overwrite the shared track list', async () => {
  const { stub, emitted, transport } = countingTrackList();
  await transport.connect(admission);
  emitted.length = 0;
  transport.stopTracks();
  await transport.disconnect();
  stub.fire(RoomEvent.LocalTrackPublished);
  stub.fire(RoomEvent.TrackUnsubscribed);
  assert({
    given: 'late SDK events from a released transport',
    should: 'emit nothing after the final empty list',
    actual: emitted,
    expected: [0],
  });
});

test('a media connection failure says whether it can pass by itself', async () => {
  const outcome = async (failure: Error) => {
    const stub = stubSdk({ settles: true });
    const reports: MediaRoomEvent[] = [];
    // As the SDK does: Disconnected fires first, then connect rejects.
    stub.sdk.room().connect = async () => {
      stub.fire(RoomEvent.Disconnected, DisconnectReason.USER_REJECTED);
      throw failure;
    };
    const room = createLiveKitRoom(
      {
        report: (event) => void reports.push(event),
        handles: () => undefined,
        checkedDevices: () => ({ state: 'available', choices: {} }),
      },
      stub.sdk,
    );
    await room.connect(admission);
    return reports;
  };
  assert({
    given: 'a socket failure, LiveKit refusing the token, and a room it lost',
    should:
      'report through the rejection alone, and call only the refusal about authority',
    actual: [
      await outcome(ConnectionError.serverUnreachable('unreachable')),
      await outcome(ConnectionError.notAllowed('refused', 401)),
      await outcome(ConnectionError.notAllowed('no such room', 404)),
    ],
    expected: [
      [{ type: 'connect-failed', failure: 'transient' }],
      [{ type: 'connect-failed', failure: 'ending' }],
      [{ type: 'connect-failed', failure: 'transient' }],
    ],
  });
});

test('another connection taking this seat stops here rather than fighting for it', async () => {
  const stub = stubSdk();
  const heard: string[] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      reconnect: () => void heard.push('reconnect'),
      replaced: () => void heard.push('replaced'),
    },
    stub.sdk,
  );
  await transport.connect(admission);
  stub.fire(RoomEvent.Disconnected, DisconnectReason.DUPLICATE_IDENTITY);
  assert({
    given: 'LiveKit disconnecting this seat because it connected elsewhere',
    should: 'report it as replaced, and not reconnect',
    actual: heard,
    expected: ['replaced'],
  });
});

test('patience ends for an open prompt, never for a hung publish', async () => {
  let expire = () => undefined as void;
  const outcome = async (stub: ReturnType<typeof stubSdk>) => {
    const { transport } = createBrowserMediaTransport(
      {
        ...events,
        capturePatience: (expired) => {
          expire = expired;
          return () => undefined;
        },
      },
      stub.sdk,
    );
    let settled = false;
    void transport.apply(publish(['camera'])).then(() => {
      settled = true;
    });
    await settle();
    expire();
    await settle();
    return settled;
  };
  assert({
    given:
      'a prompt nobody answers, then a capture whose publish never settles',
    should: 'stop waiting for the prompt, and keep the hung publish visible',
    actual: [
      await outcome(stubSdk({ captureGates: [new Promise(() => undefined)] })),
      await outcome(stubSdk({ settles: false })),
    ],
    expected: [true, false],
  });
});

test('a warm microphone published again is watched once', async () => {
  const stub = stubSdk({ settles: true });
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  await transport.apply(publish(['camera', 'microphone']));
  const microphone = stub.published.find(
    (track) => track.source === 'microphone',
  )!;
  let added = 0;
  const on = microphone.on.bind(microphone);
  microphone.on = (event, listener) => {
    added++;
    return on(event, listener);
  };
  await transport.apply(publish(['camera']));
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given: 'a kept microphone published a second time',
    should: 'add no second set of listeners',
    actual: added,
    expected: 0,
  });
});

test('a report clears when its source stops being wanted', async () => {
  const stub = stubSdk({ settles: true, failFirstPublish: true });
  const cleared: string[] = [];
  const { transport } = createBrowserMediaTransport(
    { ...events, sourceHealthy: (source) => void cleared.push(source) },
    stub.sdk,
  );
  await transport.apply(publish(['camera']));
  transport.allowRecapture();
  await transport.apply(publish([]));
  assert({
    given: 'a failed camera, a Retry, then a read that drops the grant',
    should: 'clear the camera from the bar',
    actual: cleared.includes('camera'),
    expected: true,
  });
});

test('a device swap on the bar clears when that source stops being wanted', async () => {
  const stub = stubSdk({ settles: true });
  const cleared: string[] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      checkedDevices: () => ({
        state: 'available',
        choices: { camera: 'checked-mic' },
      }),
      sourceHealthy: (source) => void cleared.push(source),
    },
    stub.sdk,
  );
  await transport.apply(publish(['camera']));
  const camera = stub.published.find((track) => track.source === 'camera')!;
  cleared.length = 0;
  camera.mediaStreamTrack.deviceId = 'other';
  camera.emit(TrackEvent.Restarted);
  await transport.apply(publish([]));
  assert({
    given: 'a checked camera swapped by the SDK, then the grant dropping',
    should: 'clear the camera from the bar',
    actual: cleared.includes('camera'),
    expected: true,
  });
});

test('a removal report lasts until the next grant or a Retry, not the next read', async () => {
  const stub = stubSdk({ settles: true, failFirstUnpublish: true });
  const cleared: string[] = [];
  const failed: string[] = [];
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      sourceFailed: (source, failure) =>
        void failed.push(`${source}:${failure.kind}`),
      sourceHealthy: (source) => void cleared.push(source),
    },
    stub.sdk,
  );
  await transport.apply(publish(['camera']));
  await settle();
  cleared.length = 0;
  await transport.apply(publish([]));
  await transport.apply(publish([]));
  const afterReads = [...cleared];
  transport.allowRecapture();
  assert({
    given: 'a camera whose unpublish failed, more reads, then Retry',
    should: 'keep naming it through the reads and clear it on Retry',
    actual: { failed, afterReads, afterRetry: cleared },
    expected: {
      failed: ['camera:removal'],
      afterReads: [],
      afterRetry: ['camera'],
    },
  });
});

test('unmuting a released microphone cannot reopen the device', async () => {
  const stub = stubSdk({ settles: true });
  const reported: string[] = [];
  const room = createLiveKitRoom(
    {
      report: (event) => reported.push(event.type),
      handles: () => undefined,
      checkedDevices: () => ({ state: 'available', choices: {} }),
    },
    stub.sdk,
  );
  await room.capture('microphone', false);
  const microphone = stub.captured[0]!;
  await microphone.mute();
  room.releaseTrack('microphone');
  await room.setMuted(false);
  assert({
    given: 'a microphone the model released, then Unmute',
    should: 'leave the stopped track alone and finish the change',
    actual: [microphone.muted, microphone.ended, reported.at(-1)],
    expected: [true, true, 'mute-applied'],
  });
});

test('tracks stopped by a local failure still follow the connected room', async () => {
  const stub = stubSdk({ settles: true });
  let emitted = 0;
  const room = createLiveKitRoom(
    {
      report: () => undefined,
      handles: () => void emitted++,
      checkedDevices: () => ({ state: 'available', choices: {} }),
    },
    stub.sdk,
  );
  await room.capture('camera', false);
  room.releaseTrack('camera');
  const before = emitted;
  stub.fire(RoomEvent.TrackSubscribed);
  assert({
    given: 'local tracks stopped while the room stays connected',
    should: 'keep reporting the room, so remote media can return',
    actual: emitted - before,
    expected: 1,
  });
});

test('a device lost while its publish ran is reported once it lands', async () => {
  const stub = stubSdk({ settles: true });
  const reported: string[] = [];
  const room = createLiveKitRoom(
    {
      report: (event) => reported.push(event.type),
      handles: () => undefined,
      checkedDevices: () => ({ state: 'available', choices: {} }),
    },
    stub.sdk,
  );
  await room.capture('camera', false);
  stub.captured[0]!.mediaStreamTrack.readyState = 'ended';
  await room.publish('camera', false);
  assert({
    given: 'a camera whose device dies before its publish settles',
    should:
      'report published and then ended, so the model does not call it healthy',
    actual: reported.filter((type) => type.match(/published|track-ended/)),
    expected: ['published', 'track-ended'],
  });
});

test('the SDK saying a signal resume began reports a blip', async () => {
  const stub = stubSdk();
  const said: string[] = [];
  const room = createLiveKitRoom(
    {
      report: (event) => said.push(event.type),
      handles: () => undefined,
      checkedDevices: () => ({ state: 'available', choices: {} }),
    },
    stub.sdk,
  );
  await room.connect(admission);
  stub.fire(RoomEvent.SignalReconnecting);
  stub.fire(RoomEvent.Reconnected);
  assert({
    given: 'an ordinary signal resume',
    should: 'say it began and that it landed',
    actual: said.filter((type) => type.startsWith('transport')),
    expected: ['transport-resuming', 'transport-resumed'],
  });
});
