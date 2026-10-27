import type { OpenRouter } from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import { createAudioPublication } from '@daisy/media/audio';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import type { ProviderCall } from '../../server/provider-budget';
import { createBotActivityFeed } from './activity-feed';
import { createBotGeneration } from './generation';
import { createBotPublisher } from './publication';
import { createBotSeat } from './seat';
import { createBotSpeaker } from './speaker';
import type { WorkerTimers } from '../../server/worker-timers';

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
  readonly readActivity: Parameters<typeof createBotActivityFeed>[0]['read'];
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
        ? createBotActivityFeed({
            roundId: claim.scope.roundId,
            participantId: claim.scope.roundParticipantId,
            peerParticipantIds: claim.peerParticipantIds,
            read: input.readActivity,
            databaseNow: input.store.databaseNow,
            playing: speaker.playing,
            onEvent: ({ kind }) => speaker.peer(kind),
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
