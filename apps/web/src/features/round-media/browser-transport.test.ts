import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomEvent, Track } from 'livekit-client';
import { createBrowserMediaTransport } from './browser-transport';
setupRitewayBun();

/** A captured local track that records whether anything stopped it. */
const capturedTrack = (source: string) => ({
  source,
  ended: false,
  stop() {
    this.ended = true;
  },
});
type Captured = ReturnType<typeof capturedTrack>;

/**
 * A Room whose disconnect and unpublish stop nothing, and whose publish never
 * settles: only the transport's own track.stop() can end a captured track.
 */
function stubSdk(
  options: {
    readonly captureGate?: Promise<void>;
    readonly missingSource?: 'camera' | 'microphone';
    /** Publishes settle at once, recorded in `published`. */
    readonly settles?: boolean;
  } = {},
) {
  const captures: unknown[] = [];
  const captured: Captured[] = [];
  const published: Captured[] = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const localParticipant = {
    trackPublications: new Map(),
    permissions: undefined as
      { canPublish: boolean; canPublishSources: number[] } | undefined,
    publishTrack: (track: Captured) => {
      if (!options.settles) return new Promise(() => {});
      published.push(track);
      return Promise.resolve();
    },
    unpublishTrack: async (track: Captured) => {
      published.splice(published.indexOf(track), 1);
    },
  };
  const room = {
    localParticipant,
    remoteParticipants: new Map(),
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler);
      return room;
    },
    connect: async () => undefined,
    disconnect: async () => undefined,
    removeAllListeners: () => undefined,
    startAudio: async () => undefined,
  };
  return {
    captures,
    captured,
    published,
    fire: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
    /** LiveKit changes this participant's own permission. */
    permit: (sources: Track.Source[]) => {
      localParticipant.permissions = {
        canPublish: sources.length > 0,
        canPublishSources: sources.map((source) => Track.sourceToProto(source)),
      };
      handlers.get(RoomEvent.ParticipantPermissionsChanged)?.(
        undefined,
        localParticipant,
      );
    },
    sdk: {
      room: () => room,
      capture: async (options_: { audio: boolean; video: unknown }) => {
        captures.push(options_);
        if (
          options.missingSource === (options_.audio ? 'microphone' : 'camera')
        )
          throw new DOMException('private', 'OverconstrainedError');
        await options.captureGate;
        const track = capturedTrack(options_.audio ? 'microphone' : 'camera');
        captured.push(track);
        return [track];
      },
    } as never,
  };
}
const events = { tracks: () => {}, invalidated: () => {}, reconnect: () => {} };
const publish = (sources: string[]) =>
  ({ grants: { publish: sources } }) as never;
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
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
    actual: stub.captured.map((track) => [track.source, track.ended]),
    expected: [['camera', true]],
  });
});

test('a track captured after a terminal stop is ended at once', async () => {
  const gate = Promise.withResolvers<void>();
  const stub = stubSdk({ captureGate: gate.promise });
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

const sources = (tracks: readonly Captured[]) =>
  tracks.map((track) => track.source);

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

test('Round capture pins the same camera and warm microphone that passed the Room check', async () => {
  const stub = stubSdk({ settles: true });
  const { transport } = createBrowserMediaTransport(
    {
      ...events,
      devices: { camera: 'checked-camera', microphone: 'checked-mic' },
    },
    stub.sdk,
  );
  await transport.apply(publish(['camera']));
  await transport.apply(publish(['camera', 'microphone']));
  assert({
    given:
      'non-default checked devices and a microphone warmed before its grant',
    should: 'capture each exact device once and publish those tracks',
    actual: {
      choices: stub.captures.map((capture) => {
        const options = capture as { audio: unknown; video: unknown };
        return options.audio
          ? options.audio
          : (options.video as { deviceId: unknown }).deviceId;
      }),
      published: sources(stub.published),
    },
    expected: {
      choices: [
        { exact: 'checked-camera' },
        { deviceId: { exact: 'checked-mic' } },
      ],
      published: ['camera', 'microphone'],
    },
  });
  transport.stopTracks();
});

for (const source of ['camera', 'microphone'] as const) {
  test(`a missing selected ${source} fails at Round entry without fallback`, async () => {
    const stub = stubSdk({ settles: true, missingSource: source });
    const { transport } = createBrowserMediaTransport(
      { ...events, devices: { [source]: 'gone-device' } },
      stub.sdk,
    );
    let failure = '';
    try {
      await transport.apply(publish(['camera']));
    } catch (error) {
      failure = (error as Error).name;
    }
    assert({
      given: `a selected ${source} missing before its first publication`,
      should:
        'surface the exact-device failure at Round entry without trying a default',
      actual: {
        failure,
        captures: stub.captures.length,
        published: sources(stub.published),
      },
      expected: {
        failure: 'OverconstrainedError',
        captures: source === 'camera' ? 1 : 2,
        published: source === 'camera' ? [] : ['camera'],
      },
    });
    transport.stopTracks();
  });
}
