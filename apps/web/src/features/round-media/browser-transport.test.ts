import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomEvent, Track } from 'livekit-client';
import { createBrowserMediaTransport } from './browser-transport';
import {
  events,
  publish,
  settle,
  sources,
  stubSdk,
} from './browser-transport.test-support';
setupRitewayBun();

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
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [['camera', true]],
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
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [['camera', true]],
  });
});

test('an unexpected disconnect ends every captured track', async () => {
  const stub = stubSdk();
  const { transport } = createBrowserMediaTransport(events, stub.sdk);
  void transport.apply(publish(['camera']));
  await settle();
  stub.fire(RoomEvent.Disconnected);
  assert({
    given: 'a captured camera when the room disconnects on its own',
    should: 'end it, since LiveKit skips a room already disconnected',
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [['camera', true]],
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
test('POI local mute changes audio without changing server publish grants', async () => {
  const stub = stubSdk({ settles: true });
  const browser = createBrowserMediaTransport(
    { ...events, microphoneMuted: true },
    stub.sdk,
  );
  await browser.transport.apply(publish(['camera', 'microphone']));
  const microphone = stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
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

test('a failed local microphone change stops capture before offering device recovery', async () => {
  const stub = stubSdk({ settles: true });
  const browser = createBrowserMediaTransport(
    { ...events, microphoneMuted: true },
    stub.sdk,
  );
  await browser.transport.apply(publish(['camera', 'microphone']));
  const microphone = stub.captured.find(
    (track) => track.source === 'microphone',
  )!;
  microphone.unmute = async () => {
    throw new Error('Device disconnected');
  };
  let failed = false;
  try {
    await browser.setMicrophoneMuted(false);
  } catch {
    failed = true;
  }
  assert({
    given: 'unmuting fails with an unknown track outcome',
    should:
      'fail and stop every captured track instead of leaving unknown audio live',
    actual: [failed, stub.captured.every((track) => track.ended)],
    expected: [true, true],
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
  let observed: readonly import('./browser-transport').MediaTrack[] = [];
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

test('browser playback refusal and recovery are reported from actual SDK state', () => {
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
  stub.fire(RoomEvent.AudioPlaybackStatusChanged);
  allowed = true;
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
    expected: [[true], []],
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
