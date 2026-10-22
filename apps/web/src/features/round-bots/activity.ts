import { createTurnTaking, defaultTurnTakingSettings } from '@daisy/ai-voice';
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
type PeerState = {
  trackId: string;
  sequence: number;
  afterMs: number;
  oldestServerMs: number;
  turns: ReturnType<typeof createTurnTaking>;
};
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
function follows(
  previous: PeerState | undefined,
  frame: BotAudioActivityFrame,
): previous is PeerState {
  return (
    previous?.trackId === frame.trackId &&
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
/** Ephemeral heuristic only. Its events may cancel a phrase, never alter attendance/floor/credit or the control lease. */
export function createBotAudioActivity(input: {
  readonly roundId: string;
  readonly participantId: string;
  readonly peerParticipantIds: readonly string[];
  readonly staleAfterMs: number;
  readonly playing: () => boolean;
  readonly onEvent: (event: {
    readonly kind: 'speech-start' | 'end-of-turn' | 'barge-in' | 'unknown';
    readonly roundParticipantId: string;
  }) => void;
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
  const states = new Map<string, PeerState>();
  const unknown = (participantId: string) => {
    states.delete(participantId);
    input.onEvent({ kind: 'unknown', roundParticipantId: participantId });
  };
  const observeKnownPeer = (frame: BotAudioActivityFrame) => {
    if (!freshFrame(frame, input.staleAfterMs)) {
      unknown(frame.roundParticipantId);
      return;
    }
    const previous = states.get(frame.roundParticipantId);
    if (duplicate(previous, frame)) return;
    const continuous = follows(previous, frame);
    if (previous && !continuous) unknown(frame.roundParticipantId);
    const state = continuous
      ? previous
      : {
          trackId: frame.trackId,
          turns: createTurnTaking(defaultTurnTakingSettings),
          sequence: frame.sequence,
          afterMs: frame.afterMs,
          oldestServerMs: Date.parse(frame.serverWindow.before),
        };
    state.sequence = frame.sequence;
    state.afterMs = frame.afterMs;
    state.oldestServerMs = Date.parse(frame.serverWindow.before);
    states.set(frame.roundParticipantId, state);
    const kind = state.turns.feed({
      at: frame.afterMs,
      level: rms(frame.pcm),
      aiPlaying: input.playing(),
    });
    if (kind)
      input.onEvent({ kind, roundParticipantId: frame.roundParticipantId });
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
      const state = states.get(scope.roundParticipantId);
      if (!state || state.trackId === scope.trackId)
        unknown(scope.roundParticipantId);
    },
    /** Actual PG time or a conservatively calibrated server bound; never local monotonic ingress time. */
    expire: (serverNow: string) => {
      const at = Date.parse(serverNow);
      if (!Number.isFinite(at)) throw createAppError('VALIDATION');
      for (const [participantId, state] of states)
        if (
          at < state.oldestServerMs ||
          at - state.oldestServerMs > input.staleAfterMs
        )
          unknown(participantId);
    },
  };
}
