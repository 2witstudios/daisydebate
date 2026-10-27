import { RoomEvent, Track } from 'livekit-client';

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
export function stubSdk(
  options: {
    readonly missingSource?: 'camera' | 'microphone';
    /** The browser error a missing source throws; OverconstrainedError by default. */
    readonly missingError?: string;
    /** Each capture waits for its gate here, in call order; undefined passes at once. */
    readonly captureGates?: readonly (Promise<void> | undefined)[];
    /** Publishes settle at once, recorded in `published`. */
    readonly settles?: boolean;
    readonly unpublishGate?: Promise<void>;
  } = {},
) {
  const captures: unknown[] = [];
  const captured: Captured[] = [];
  const published: Captured[] = [];
  const gates = [...(options.captureGates ?? [])];
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
      await options.unpublishGate;
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
          throw new DOMException(
            'private',
            options.missingError ?? 'OverconstrainedError',
          );
        await gates.shift();
        const track = capturedTrack(options_.audio ? 'microphone' : 'camera');
        captured.push(track);
        return [track];
      },
    } as never,
  };
}
export const events = {
  tracks: () => {},
  invalidated: () => {},
  reconnect: () => {},
};
export const publish = (sources: string[]) =>
  ({ grants: { publish: sources } }) as never;
export const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
export const sources = (tracks: readonly Captured[]) =>
  tracks.map((track) => track.source);
