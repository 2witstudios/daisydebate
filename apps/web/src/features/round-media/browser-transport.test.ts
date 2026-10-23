import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoomEvent } from 'livekit-client';
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
function stubSdk(options: { readonly captureGate?: Promise<void> } = {}) {
  const captured: Captured[] = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const room = {
    localParticipant: {
      trackPublications: new Map(),
      publishTrack: () => new Promise(() => {}),
      unpublishTrack: async () => undefined,
    },
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
    captured,
    fire: (event: string) => handlers.get(event)?.(),
    sdk: {
      room: () => room,
      capture: async (options_: { audio: boolean; video: unknown }) => {
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
