import type { OpenRouter } from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
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
import type { OneShotTimer, WorkerTimers } from '../../lib/worker-timers';

/** Resolves at a `performance.now()` instant, or at once when `signal` aborts. */
const waitUntilMonotonic = (due: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, due - performance.now()));
    signal.addEventListener('abort', done, { once: true });
  });
type Claim = Awaited<ReturnType<Database['claimRoundBotWorker']>>;
const ACTIVITY_POLL_MS = 50;
const MAX_TOKENS = 2000;
const MAX_ATTEMPTS = 2;
/** Wraps each owned claim's receipts with its scoped speaker; receipts never await speech. */
export function createSpeakingBotControl(input: {
  readonly store: Pick<
    Database,
    | 'beginRoundBotGeneration'
    | 'finishRoundBotGeneration'
    | 'verifyRoundBotPublication'
    | 'beginRoundBotPhrase'
    | 'endRoundBotPhrase'
    | 'revealRoundBotPhrase'
    | 'watchRoundBotFloor'
    | 'readRoundBotPeerLine'
    | 'databaseNow'
  >;
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
  readonly timers: WorkerTimers;
  /** Wakes a speaker again after a refusal, and after an unanswered question. */
  readonly oneShot: OneShotTimer;
  readonly nextId: () => string;
  readonly nowMs: () => number;
  readonly callTimeoutMs: number;
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
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxTokens: MAX_TOKENS,
  });
  const publisher = createBotPublisher({
    store: input.store,
    botToken: input.botToken,
    connect: createAudioPublication,
    nextId: input.nextId,
    monotonicNowMs: () => performance.now(),
    waitUntilMs: waitUntilMonotonic,
  });
  const bounded = (signal: AbortSignal) =>
    AbortSignal.any([signal, AbortSignal.timeout(input.callTimeoutMs)]);
  return (
    claim: Claim,
    receipts: { readonly pulse: () => Promise<unknown> },
  ) => {
    const publication = publisher(claim);
    const crossEx = claim.segmentType === 'cross_ex';
    const speaker = createBotSpeaker({
      claim,
      generate: (scope, token, signal, to) =>
        generation.generate(scope, token, bounded(signal), to),
      // Only a cross-examination answer has a peer's words to wait for.
      heard: crossEx
        ? createPeerLineWait({
            claim,
            readPeerLine: input.store.readRoundBotPeerLine,
            sleep: (ms, signal) =>
              waitUntilMonotonic(performance.now() + ms, signal),
            monotonicNowMs: () => performance.now(),
            observed: input.hearingObserved,
          })
        : async () => undefined,
      timer: input.oneShot,
      synthesize: (scope, token, phraseId, text, signal) =>
        generation.synthesize(scope, token, phraseId, text, bounded(signal)),
      deadline: publication.deadline,
      lineClosed: publication.lineClosed,
      tailCut: publication.tailCut,
      writeAhead: publication.writeAhead,
      discard: publication.discard,
      audible: publication.audible,
      silence: publication.silence,
      publish: publication.publish,
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
          monotonicNowMs: () => performance.now(),
          playing: speaker.playing,
          onEvent: (event) =>
            speaker.peer(
              event.kind === 'end-of-turn'
                ? {
                    kind: event.kind,
                    peer: event.roundParticipantId,
                    spokeUntilMs: event.spokeUntilMs,
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
      timers: input.timers,
      failed: input.failed,
    });
  };
}
