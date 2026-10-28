import type { OpenRouter } from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import { createAudioPublication } from '@daisy/media/audio';
import { createAudioSubscription } from '@daisy/media/subscription';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import type { ProviderCall } from '../../server/provider-budget';
import { createBotGeneration } from './generation';
import { createBotListening } from './listening';
import { createBotPublisher } from './publication';
import { createBotSeat } from './seat';
import { createBotSpeaker } from './speaker';
import type { WorkerTimers } from '../../lib/worker-timers';

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
    | 'databaseNow'
  >;
  readonly voice: () => Pick<OpenRouter, 'complete' | 'speakPcm'>;
  readonly withProvider: ProviderCall;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ readonly url: string; readonly token: string }>;
  /** The bot seat's own listen-only grant for cross-examination (ISSUE-764). */
  readonly listenToken: Parameters<typeof createBotListening>[0]['listenToken'];
  readonly readPeers: Parameters<typeof createBotListening>[0]['readPeers'];
  /** The seat capture reports hearing a track for (ISSUE-514-r2). */
  readonly readHeard: Parameters<typeof createBotPublisher>[0]['heard'];
  readonly timers: WorkerTimers;
  readonly nextId: () => string;
  readonly nowMs: () => number;
  readonly callTimeoutMs: number;
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const generation = createBotGeneration({
    store: input.store,
    voice: input.voice,
    withProvider: input.withProvider,
    nowMs: input.nowMs,
    maxTokens: MAX_TOKENS,
  });
  const publisher = createBotPublisher({
    store: input.store,
    botToken: input.botToken,
    connect: createAudioPublication,
    heard: input.readHeard,
    nextId: input.nextId,
    monotonicNowMs: () => performance.now(),
    waitUntilMs: async (due, signal) => {
      while (!signal.aborted && performance.now() < due)
        await Bun.sleep(Math.max(1, due - performance.now()));
    },
  });
  const bounded = (signal: AbortSignal) =>
    AbortSignal.any([signal, AbortSignal.timeout(input.callTimeoutMs)]);
  return (
    claim: Claim,
    receipts: { readonly pulse: () => Promise<unknown> },
  ) => {
    const publication = publisher(claim);
    const speaker = createBotSpeaker({
      claim,
      generate: (scope, token, signal) =>
        generation.generate(scope, token, bounded(signal)),
      synthesize: (scope, token, phraseId, text, signal) =>
        generation.synthesize(scope, token, phraseId, text, bounded(signal)),
      publish: publication.publish,
      nextId: input.nextId,
      maxAttempts: MAX_ATTEMPTS,
      failed: input.failed,
    });
    const feed =
      claim.segmentType === 'cross_ex'
        ? createBotListening({
            claim,
            listenToken: input.listenToken,
            readPeers: input.readPeers,
            subscribe: createAudioSubscription,
            databaseNow: input.store.databaseNow,
            monotonicNowMs: () => performance.now(),
            playing: speaker.playing,
            onEvent: ({ kind }) => speaker.peer(kind),
            failed: (error) => input.failed(error, 'listen'),
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
