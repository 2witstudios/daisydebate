import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createFrameClock } from '@daisy/media/observation';
import type { createAudioSubscription } from '@daisy/media/subscription';
import { createBotAudioActivity } from './activity';

type Subscription = Awaited<ReturnType<typeof createAudioSubscription>>;
type Frame = Parameters<
  Parameters<typeof createAudioSubscription>[0]['onFrame']
>[0];
type Calibration = Parameters<typeof createFrameClock>[0];
type Observer = Parameters<typeof createBotAudioActivity>[0];

/** Stale peer audio reads as unknown, never as silence. */
const STALE_AFTER_MS = 250;
/** How often the listener re-reads PostgreSQL time to calibrate its clocks. */
const CALIBRATE_EVERY_MS = 1000;
/** A dropped connection is rejoined after this pause, and no sooner. */
const REJOIN_AFTER_MS = 1000;

/** The listen grant: a hidden, subscribe-only identity in the claim's media session, and its peers. */
type ListenGrant = {
  readonly url: string;
  readonly token: string;
  readonly peers: readonly {
    readonly participantId: string;
    readonly identity: string;
  }[];
};

/**
 * The bot seat's own hearing in cross-examination (ISSUE-764). It joins the
 * media session with its own listen-only identity (`listenToken`: hidden,
 * subscribes, never publishes, admitted only for this live claim), and
 * feeds each peer's frames to the bot's turn-taking in memory, timed on its
 * own calibration against PostgreSQL time. No capture worker, relay or
 * Redis key is in the path, so neither a capture refusal nor a full capture
 * fleet deafens the bot. It lives exactly as long as the claim: `close`
 * ends it, and a Round end or a revoked seat, which rotates or deletes the
 * vendor room, drops it and the claim's own admission refuses a rejoin.
 * Media grants decide who may publish, so only a seat holding the floor is
 * heard at all.
 */
export function createBotListening(
  input: {
    readonly claim: {
      readonly scope: BotPublicationScope;
      readonly token: string;
      readonly peerParticipantIds: readonly string[];
    };
    readonly listenToken: (
      scope: BotPublicationScope,
      token: string,
    ) => Promise<ListenGrant>;
    /**
     * The session's current seat bindings: a read, never a signed grant, so
     * a peer whose media binds after the join is heard (ISSUE-764).
     */
    readonly readPeers: (
      scope: BotPublicationScope,
    ) => Promise<ListenGrant['peers']>;
    readonly subscribe: typeof createAudioSubscription;
    readonly databaseNow: () => Promise<string>;
    readonly monotonicNowMs: () => number;
  } & Pick<Observer, 'playing' | 'onEvent'>,
) {
  const { scope } = input.claim;
  const observer = createBotAudioActivity({
    roundId: scope.roundId,
    participantId: scope.roundParticipantId,
    peerParticipantIds: input.claim.peerParticipantIds,
    staleAfterMs: STALE_AFTER_MS,
    playing: input.playing,
    onEvent: input.onEvent,
  });
  const peers = new Set(input.claim.peerParticipantIds);
  const seats = new Map<string, string>();
  const clocks = new Map<string, ReturnType<typeof createFrameClock>>();
  let calibration: Calibration | null = null;
  let calibratedAt = -Infinity;
  let subscription: Subscription | null = null;
  let joining: Promise<void> | null = null;
  let rejoinAt = -Infinity;
  let peersReadAt = -Infinity;
  let closed = false;
  /** Seats for the claim's peers in `bound`; true when the set changed. */
  const bindPeers = (bound: ListenGrant['peers']) => {
    const before = [...seats.keys()].join();
    seats.clear();
    for (const binding of bound)
      if (peers.has(binding.participantId))
        seats.set(binding.identity, binding.participantId);
    return [...seats.keys()].join() !== before;
  };
  /** A peer still unbound is read again, at most once a calibration period. */
  const refreshPeers = async (current: Subscription) => {
    const now = input.monotonicNowMs();
    if (seats.size >= peers.size || now - peersReadAt < CALIBRATE_EVERY_MS)
      return;
    peersReadAt = now;
    if (bindPeers(await input.readPeers(scope)) && subscription === current)
      await current.setIdentities([...seats.keys()]);
  };

  /** The server instant now, mapped through the latest calibration. */
  const serverNowMs = (at: number, current: Calibration) =>
    current.serverNowMs + (at - current.receivedAtMs);

  const hear = (frame: Frame) => {
    const seat = seats.get(frame.identity);
    if (closed || !calibration || !seat) return;
    let clock = clocks.get(frame.trackId);
    if (!clock) {
      clock = createFrameClock(calibration);
      clocks.set(frame.trackId, clock);
    }
    const window = clock.observe(frame);
    if (!window) return;
    const after = Math.ceil(window.afterMs);
    observer.observe({
      roundId: scope.roundId,
      roundParticipantId: seat,
      trackId: frame.trackId,
      sequence: frame.sequence,
      pcm: frame.pcm,
      beforeMs: frame.beforeMs,
      afterMs: frame.afterMs,
      serverWindow: {
        before: new Date(Math.floor(window.beforeMs)).toISOString(),
        after: new Date(after).toISOString(),
      },
      receivedAt: new Date(
        Math.max(after, serverNowMs(input.monotonicNowMs(), calibration)),
      ).toISOString(),
    });
  };

  const join = async () => {
    const grant = await input.listenToken(scope, input.claim.token);
    bindPeers(grant.peers);
    peersReadAt = input.monotonicNowMs();
    const opened = await input.subscribe({
      url: grant.url,
      token: grant.token,
      identities: [...seats.keys()],
      nowMs: input.monotonicNowMs,
      onFrame: hear,
      onTrackStarted: () => undefined,
      onTrackClosed: (track) => {
        clocks.delete(track.trackId);
        const seat = seats.get(track.identity);
        if (seat)
          observer.unknown({
            roundId: scope.roundId,
            roundParticipantId: seat,
            trackId: track.trackId,
          });
      },
    });
    if (closed) {
      await opened.close();
      return;
    }
    subscription = opened;
    void opened.closed.then(() => {
      if (subscription !== opened) return;
      // Dropped (a rotated or deleted room, a lost connection): no frame
      // arrives, so the next polls expire every peer to unknown until a
      // rejoin hears it again.
      subscription = null;
      clocks.clear();
      rejoinAt = input.monotonicNowMs() + REJOIN_AFTER_MS;
    });
  };
  const ensureJoined = () => {
    if (closed || subscription || joining) return;
    if (input.monotonicNowMs() < rejoinAt) return;
    joining = join()
      .catch(() => {
        rejoinAt = input.monotonicNowMs() + REJOIN_AFTER_MS;
      })
      .finally(() => {
        joining = null;
      });
  };
  const calibrate = async () => {
    const sentAtMs = input.monotonicNowMs();
    if (sentAtMs - calibratedAt < CALIBRATE_EVERY_MS && calibration) return;
    const server = Date.parse(await input.databaseNow());
    const receivedAtMs = input.monotonicNowMs();
    calibration = {
      sentAtMs,
      receivedAtMs,
      serverNowMs: server,
      precisionMs: 1,
    };
    calibratedAt = receivedAtMs;
    for (const clock of clocks.values()) clock.refresh(calibration);
  };

  return {
    /** Joins with the seat, ahead of the cross-ex turns it hears. */
    start: () => {
      ensureJoined();
    },
    /** Each seat poll: rejoin after a drop, recalibrate, and age out stale peers. */
    async poll() {
      if (closed) return;
      ensureJoined();
      await calibrate();
      if (subscription) await refreshPeers(subscription);
      if (calibration)
        observer.expire(
          new Date(
            serverNowMs(input.monotonicNowMs(), calibration),
          ).toISOString(),
        );
    },
    /** Ends with the claim; a join still in flight closes as it lands. */
    async close() {
      closed = true;
      const current = subscription;
      subscription = null;
      clocks.clear();
      await current?.close();
      await joining;
    },
  };
}
