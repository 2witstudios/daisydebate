import type { RoundWorkerStore } from '@daisy/db/stores/round-workers';
import type { RoundStore } from '@daisy/db/stores/rounds';
import type { OpenRouter } from '@daisy/ai-voice';
import { deadlineSignal, type Waits } from '@daisy/clock';
import { createAudioPublication } from '@daisy/media/audio';
import { createAudioSubscription } from '@daisy/media/subscription';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import type { ProviderCall } from '../../server/provider-budget';
import { createBotGeneration } from './generation';
import { createBotListening } from './listening';
import { createPeerLineWait } from './peer-line';
import { createBotPublisher } from './publication';
import { createBotSeat } from './seat';
import { createBotSpeaker } from './speaker';
type Claim = Awaited<ReturnType<RoundWorkerStore['claimRoundBotWorker']>>;
const ACTIVITY_POLL_MS = 50;
const MAX_TOKENS = 2000;
const MAX_ATTEMPTS = 2;
/** Wraps each owned claim's receipts with its scoped speaker; receipts never await speech. */
export function createSpeakingBotControl(input: {
  readonly store: Pick<
    RoundWorkerStore,
    | 'beginRoundBotGeneration'
    | 'finishRoundBotGeneration'
    | 'verifyRoundBotPublication'
    | 'beginRoundBotPhrase'
    | 'endRoundBotPhrase'
    | 'revealRoundBotPhrase'
    | 'watchRoundBotFloor'
    | 'readRoundBotPeerLine'
  > &
    Pick<RoundStore, 'databaseNow'>;
  readonly voice: () => Pick<OpenRouter, 'completeStreamed' | 'speakPcm'>;
  readonly withProvider: ProviderCall;
  /** Whether a refusal is `withProvider`'s own budget being full. */
  readonly providerBusy: (error: unknown) => boolean;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{
    readonly url: string;
    readonly token: string;
    readonly roomName: string;
  }>;
  /** The bot seat's own listen-only grant for cross-examination (ISSUE-764). */
  readonly listenToken: Parameters<typeof createBotListening>[0]['listenToken'];
  readonly readPeers: Parameters<typeof createBotListening>[0]['readPeers'];
  /**
   * Monotonic time for every seat's timed work: the hearing poll, a
   * speaker's self-wakes, stall watches, call bounds and paced publication.
   */
  readonly waits: Waits;
  readonly nextId: () => string;
  readonly nowMs: () => number;
  readonly callTimeoutMs: number;
  /** The language calls' reasoning effort (ISSUE-1460). */
  readonly reasoning: Parameters<typeof createBotGeneration>[0]['reasoning'];
  readonly failed: (error: unknown, stage: string) => void;
  /** The seat's own hearing's unexpected join failures (ISSUE-764). */
  readonly hearingFailed: (error: unknown) => void;
  /** The hearing's trace: operation names, durations and error codes only. */
  readonly hearingObserved: Parameters<
    typeof createBotListening
  >[0]['observed'];
}) {
  const generation = createBotGeneration({
    store: input.store,
    voice: input.voice,
    withProvider: input.withProvider,
    nowMs: input.nowMs,
    waits: input.waits,
    stallMs: input.callTimeoutMs,
    maxTokens: MAX_TOKENS,
    reasoning: input.reasoning,
  });
  const publisher = createBotPublisher({
    store: input.store,
    botToken: input.botToken,
    connect: createAudioPublication,
    nextId: input.nextId,
    monotonicNowMs: input.waits.nowMs,
    waitUntilMs: input.waits.waitUntilMs,
  });
  /**
   * A synthesis bound: it aborts `callTimeoutMs` from now, or with the turn.
   * It is left to run out rather than cleared, since the answer's settlement
   * still reads it after the call resolves.
   */
  const bounded = (signal: AbortSignal) =>
    deadlineSignal(input.waits, input.callTimeoutMs, signal).signal;
  return (
    claim: Claim,
    receipts: { readonly pulse: () => Promise<unknown> },
  ) => {
    const publication = publisher(claim);
    const crossEx = claim.segmentType === 'cross_ex';
    const speaker = createBotSpeaker({
      claim,
      generate: (scope, token, signal, to) =>
        // A streamed answer is bounded by its own stall watch, not by one
        // deadline for its whole length.
        generation.generate(scope, token, signal, to),
      // Only a cross-examination answer has a peer's words to wait for.
      heard: crossEx
        ? createPeerLineWait({
            claim,
            readPeerLine: input.store.readRoundBotPeerLine,
            sleep: input.waits.sleep,
            monotonicNowMs: input.waits.nowMs,
            observed: input.hearingObserved,
          })
        : async () => undefined,
      waits: input.waits,
      synthesize: (scope, token, phraseId, text, signal) =>
        generation.synthesize(scope, token, phraseId, text, bounded(signal)),
      publication,
      nextId: input.nextId,
      maxAttempts: MAX_ATTEMPTS,
      busy: input.providerBusy,
      failed: input.failed,
    });
    const feed = crossEx
      ? createBotListening({
          claim,
          listenToken: input.listenToken,
          readPeers: input.readPeers,
          subscribe: createAudioSubscription,
          databaseNow: input.store.databaseNow,
          waits: input.waits,
          playing: speaker.playing,
          onEvent: (event) =>
            speaker.peer(
              event.kind === 'end-of-turn'
                ? {
                    kind: event.kind,
                    peer: event.roundParticipantId,
                    spokeUntilMs: event.spokeUntilMs,
                    spokeForMs: event.spokeForMs,
                  }
                : { kind: event.kind, peer: event.roundParticipantId },
            ),
          failed: input.hearingFailed,
          observed: input.hearingObserved,
        })
      : null;
    return createBotSeat({
      control: receipts,
      speaker,
      publication,
      feed,
      pollMs: ACTIVITY_POLL_MS,
      waits: input.waits,
      failed: input.failed,
    });
  };
}
