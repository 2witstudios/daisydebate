import {
  AccessToken,
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  RoomServiceClient,
  SegmentedFileOutput,
  ServerError,
  type EgressInfo,
} from 'livekit-server-sdk';
import {
  configSchema,
  OBSERVER_IDENTITY,
  parseMedia,
  type MediaConfig,
} from './contracts';

/** Only for joining, and the stage asks every second, so an old one soon can't. */
const OBSERVER_TTL_SECONDS = 60;

export type BroadcastEgressFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'starting' | 'active'; readonly id: string }
  | { readonly kind: 'failed'; readonly id: string }
  | { readonly kind: 'complete' };

/** What the lifecycle decides on. Anything unrecognised counts as failed, never running. */
export const egressFact = (
  info: Pick<EgressInfo, 'egressId' | 'status'>,
): BroadcastEgressFact => {
  const id = info.egressId;
  switch (info.status) {
    case EgressStatus.EGRESS_STARTING:
      return { kind: 'starting', id };
    case EgressStatus.EGRESS_ACTIVE:
    case EgressStatus.EGRESS_ENDING:
      return { kind: 'active', id };
    case EgressStatus.EGRESS_COMPLETE:
      return { kind: 'complete' };
    default:
      return { kind: 'failed', id };
  }
};

/**
 * The capture a stage URL belongs to, only under this deployment's own origin, so
 * an Egress of any other deployment sharing a LiveKit is never taken for ours.
 */
export const stageCaptureId = (url: string, origin: string): string | null => {
  const prefix = `${origin}/stage/`;
  if (!url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length).split(/[/?#]/, 1)[0];
  return id ? id : null;
};

const observerPermission = (canSubscribe: boolean) => ({
  canSubscribe,
  canPublish: false,
  canPublishData: false,
  hidden: true,
});

/** All credentials are injected; the SDK's environment fallback is never used. */
export function createBroadcastEgress(deps: {
  readonly config: MediaConfig;
  readonly client?: Pick<
    EgressClient,
    'startWebEgress' | 'stopEgress' | 'listEgress'
  >;
  readonly rooms?: Pick<RoomServiceClient, 'updateParticipant'>;
}) {
  const { url, apiKey, apiSecret } = parseMedia(
    configSchema,
    deps.config,
    true,
  );
  const client = deps.client ?? new EgressClient(url, apiKey, apiSecret);
  const rooms = deps.rooms ?? new RoomServiceClient(url, apiKey, apiSecret);
  const setObserver = (room: string, on: boolean) =>
    rooms.updateParticipant(
      room,
      OBSERVER_IDENTITY,
      undefined,
      observerPermission(on),
    );
  return {
    async start(input: {
      readonly stageUrl: string;
      readonly holdPrefix: string;
      readonly segmentSeconds: number;
    }) {
      const started = await client.startWebEgress(
        input.stageUrl,
        {
          file: new EncodedFileOutput({
            filepath: `${input.holdPrefix}full.mp4`,
          }),
          segments: new SegmentedFileOutput({
            filenamePrefix: `${input.holdPrefix}s`,
            playlistName: 'p.m3u8',
            livePlaylistName: 'live.m3u8',
            segmentDuration: input.segmentSeconds,
          }),
        },
        { awaitStartSignal: true },
      );
      return started.egressId;
    },
    async stop(id: string) {
      await client.stopEgress(id);
    },
    /** A job LiveKit no longer lists is reported failed, so it cannot look alive. */
    async read(id: string): Promise<BroadcastEgressFact> {
      const [info] = await client.listEgress({ egressId: id });
      return info ? egressFact(info) : { kind: 'failed', id };
    },
    /**
     * Every running stage Egress of this deployment, whatever we recorded: what a
     * crash between a start and its record leaves is found here and nowhere else.
     */
    async listStages(origin: string) {
      const running = await client.listEgress({ active: true });
      return running.flatMap((info) => {
        const captureId =
          info.request.case === 'web'
            ? stageCaptureId(info.request.value.url, origin)
            : null;
        return captureId === null
          ? []
          : [{ egressId: info.egressId, captureId }];
      });
    },
    /** An observer no longer in the room cannot receive anything: that is confirmed. */
    revokeObserver: async (room: string) => {
      try {
        await setObserver(room, false);
      } catch (error) {
        if (!(error instanceof ServerError && error.status === 404))
          throw error;
      }
    },
    restoreObserver: (room: string) => setObserver(room, true),
    /** Carries the current phase's permission, so a reconnect cannot bypass a revocation. */
    observerToken(room: string, access: { readonly canSubscribe: boolean }) {
      const token = new AccessToken(apiKey, apiSecret, {
        identity: OBSERVER_IDENTITY,
        ttl: OBSERVER_TTL_SECONDS,
      });
      token.addGrant({
        room,
        roomJoin: true,
        ...observerPermission(access.canSubscribe),
      });
      return token.toJwt();
    },
  };
}

export type BroadcastEgress = ReturnType<typeof createBroadcastEgress>;

/**
 * One Egress client per LiveKit node, as one (ISSUE-1299). Any node reaches any room
 * and any Egress through LiveKit's Redis, so health only says which node to ask. A
 * start goes to one node, since a second attempt could not tell what the first did.
 * The rest are safe to repeat, so a fault moves on to the next node.
 */
export function broadcastEgressOnNodes(input: {
  readonly egresses: readonly BroadcastEgress[];
  /** Every node's index, healthy ones first. */
  readonly order: () => readonly number[];
}): BroadcastEgress {
  const first = input.egresses[0];
  if (!first) throw new Error('No media node is configured');
  const anyNode = async <T>(work: (egress: BroadcastEgress) => Promise<T>) => {
    let failure: unknown;
    for (const index of input.order())
      try {
        return await work(input.egresses[index]!);
      } catch (error) {
        failure = error;
      }
    throw failure;
  };
  return {
    start: (request) => input.egresses[input.order()[0]!]!.start(request),
    stop: (id) => anyNode((egress) => egress.stop(id)),
    read: (id) => anyNode((egress) => egress.read(id)),
    listStages: (origin) => anyNode((egress) => egress.listStages(origin)),
    revokeObserver: (room) => anyNode((egress) => egress.revokeObserver(room)),
    restoreObserver: (room) =>
      anyNode((egress) => egress.restoreObserver(room)),
    // Signed here with the shared key, so no node is asked.
    observerToken: first.observerToken,
  };
}
