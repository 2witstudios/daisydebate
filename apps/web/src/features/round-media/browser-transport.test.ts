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
