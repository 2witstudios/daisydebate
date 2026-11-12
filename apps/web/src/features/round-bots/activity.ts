import { createTurnTaking, turnTakingSettings } from '@daisy/ai-voice';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

export type BotAudioActivityFrame = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly trackId: string;
  readonly sequence: number;
  readonly pcm: Int16Array;
  /** Original capture-process monotonic bracket, never compared with a web clock. */
  readonly beforeMs: number;
  readonly afterMs: number;
  readonly serverWindow: { readonly before: string; readonly after: string };
  /** Fresh PG receipt supplied by the authenticated internal relay, never its public body. */
  readonly receivedAt: string;
};
/** The last frame heard from a peer: what the next one must follow. */
type PeerState = {
  trackId: string;
  sequence: number;
  afterMs: number;
  oldestServerMs: number;
};
/**
 * The bot's voice can come back through a peer's microphone a moment after
 * it stops playing: for this long after, only a barge-in level counts as
 * that peer speaking.
 */
const ECHO_TAIL_MS = 400;
/** What the hearing reports about one peer; instants are server milliseconds. */
export type BotAudioActivityEvent = {
  readonly roundParticipantId: string;
} & (
  | { readonly kind: 'speech-start' | 'barge-in' | 'unknown' }
  /** `spokeUntilMs` is when that peer last spoke. */
  | { readonly kind: 'end-of-turn'; readonly spokeUntilMs: number }
);
function freshFrame(frame: BotAudioActivityFrame, staleAfterMs: number) {
  const oldest = Date.parse(frame.serverWindow.before),
    latest = Date.parse(frame.serverWindow.after),
    receipt = Date.parse(frame.receivedAt);
  return (
    frame.pcm.length === 160 &&
    Number.isSafeInteger(frame.sequence) &&
    frame.sequence >= 0 &&
    /^[A-Za-z0-9_-]{1,128}$/.test(frame.trackId) &&
    [frame.beforeMs, frame.afterMs, oldest, latest, receipt].every(
      Number.isFinite,
    ) &&
    frame.beforeMs <= frame.afterMs &&
    oldest <= latest &&
    latest <= receipt &&
    receipt - oldest <= staleAfterMs
  );
}
function rms(pcm: Int16Array) {
  let sum = 0;
  for (const sample of pcm) sum += (sample / 32768) ** 2;
  return Math.sqrt(sum / pcm.length);
}
function follows(previous: PeerState, frame: BotAudioActivityFrame) {
  return (
    previous.trackId === frame.trackId &&
    frame.sequence === previous.sequence + 1 &&
    frame.beforeMs >= previous.afterMs
  );
}
function duplicate(
  previous: PeerState | undefined,
  frame: BotAudioActivityFrame,
) {
  return (
    previous?.trackId === frame.trackId &&
    frame.sequence === previous.sequence &&
    frame.afterMs === previous.afterMs &&
    Date.parse(frame.serverWindow.before) === previous.oldestServerMs
  );
}
/**
 * Ephemeral heuristic only. Its events move the bot's own turn-taking, never
 * attendance, floor, credit or the control lease.
 *
 * Each peer has one turn machine for the whole claim, timed on the frames'
 * server windows. A stale, gapped or missing frame makes that peer unheard:
 * reported once as `unknown`, and fed to the machine as unheard, which keeps
 * a turn in progress and ends it only after a full pause.
 */
export function createBotAudioActivity(input: {
  readonly roundId: string;
  readonly participantId: string;
  readonly peerParticipantIds: readonly string[];
  readonly staleAfterMs: number;
  readonly playing: () => boolean;
  readonly onEvent: (event: BotAudioActivityEvent) => void;
}) {
  const peers = new Set(input.peerParticipantIds);
  if (
    !Number.isSafeInteger(input.staleAfterMs) ||
    input.staleAfterMs < 1 ||
    peers.size > 255 ||
    peers.has(input.participantId) ||
    ![input.roundId, input.participantId, ...peers].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw createAppError('VALIDATION');
  const heard = new Map<string, PeerState>();
  const turns = new Map(
    [...peers].map((peer) => [peer, createTurnTaking(turnTakingSettings)]),
  );
  /** The server instant the bot was last playing, as the frames saw it. */
  let playedAt = -Infinity;
  const botPlaying = (at: number) => {
    if (input.playing()) playedAt = at;
    return at - playedAt < ECHO_TAIL_MS;
  };
  const feed = (participantId: string, at: number, level: number | null) => {
    const event = turns
      .get(participantId)
      ?.feed({ at, level, aiPlaying: botPlaying(at) });
    if (!event) return;
    input.onEvent(
      event.kind === 'end-of-turn'
        ? {
            kind: event.kind,
            roundParticipantId: participantId,
            spokeUntilMs: event.spokeUntil,
          }
        : { kind: event.kind, roundParticipantId: participantId },
    );
  };
  /** A peer heard until now is unheard: said once, until it is heard again. */
  const unknown = (participantId: string) => {
    if (heard.delete(participantId))
      input.onEvent({ kind: 'unknown', roundParticipantId: participantId });
  };
  const observeKnownPeer = (frame: BotAudioActivityFrame) => {
    if (!freshFrame(frame, input.staleAfterMs)) {
      unknown(frame.roundParticipantId);
      return;
    }
    const previous = heard.get(frame.roundParticipantId);
    if (duplicate(previous, frame)) return;
    const at = Date.parse(frame.serverWindow.after);
    if (previous && !follows(previous, frame)) {
      input.onEvent({
        kind: 'unknown',
        roundParticipantId: frame.roundParticipantId,
      });
      // The frames lost in the gap are unheard: what was heard before it
      // sustains no speech or barge-in after it.
      feed(frame.roundParticipantId, at, null);
    }
    heard.set(frame.roundParticipantId, {
      trackId: frame.trackId,
      sequence: frame.sequence,
      afterMs: frame.afterMs,
      oldestServerMs: Date.parse(frame.serverWindow.before),
    });
    feed(frame.roundParticipantId, at, rms(frame.pcm));
  };
  return {
    observe: (frame: BotAudioActivityFrame) => {
      if (
        frame.roundId === input.roundId &&
        peers.has(frame.roundParticipantId)
      )
        observeKnownPeer(frame);
    },
    unknown: (scope: {
      readonly roundId: string;
      readonly roundParticipantId: string;
      readonly trackId: string;
    }) => {
      if (
        scope.roundId !== input.roundId ||
        !peers.has(scope.roundParticipantId)
      )
        return;
      const state = heard.get(scope.roundParticipantId);
      if (state?.trackId === scope.trackId) unknown(scope.roundParticipantId);
    },
    /** Actual PG time or a conservatively calibrated server bound; never local monotonic ingress time. */
    expire: (serverNow: string) => {
      const at = Date.parse(serverNow);
      if (!Number.isFinite(at)) throw createAppError('VALIDATION');
      for (const participantId of peers) {
        const state = heard.get(participantId);
        if (
          state &&
          (at < state.oldestServerMs ||
            at - state.oldestServerMs > input.staleAfterMs)
        )
          unknown(participantId);
        // No fresh audio: a turn in progress is kept, and ends after a full pause.
        if (!heard.has(participantId)) feed(participantId, at, null);
      }
    },
  };
}
