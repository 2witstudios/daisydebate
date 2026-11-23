import type { createAudioPublication } from '@daisy/media/audio';
import type { RoundWorkerStore } from '@daisy/db/stores/round-workers';
import { createStreamingAudioWriter } from '@daisy/media/publication';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import type { PhraseFacts, StoreCall, Written } from './model/publisher';

/**
 * The publisher's I/O (ADR 0122): its store calls, joining the claim's room
 * on a fresh native track, and streaming one phrase into it in real time.
 * It decides nothing; the publisher's step says what to call, when to join
 * and how far a phrase may play.
 */
export type Publication = Awaited<ReturnType<typeof createAudioPublication>>;
/** One synthesized bot phrase, bound to its publication scope and token. */
export type BotSpeechJob = {
  readonly scope: BotPublicationScope;
  readonly token: string;
  readonly phraseId: string;
  readonly text: string;
  readonly pcm: Int16Array;
  readonly sampleRate: 24000;
  readonly channels: 1;
};
/** What a claim's publisher is given. */
export type Input = {
  readonly store: Pick<
    RoundWorkerStore,
    | 'verifyRoundBotPublication'
    | 'beginRoundBotPhrase'
    | 'endRoundBotPhrase'
    | 'revealRoundBotPhrase'
    | 'watchRoundBotFloor'
  >;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ url: string; token: string; roomName: string }>;
  readonly connect: typeof createAudioPublication;
  readonly nextId: () => string;
  readonly monotonicNowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
};
type Clock = Pick<Input, 'monotonicNowMs' | 'waitUntilMs'>;
const SAMPLE_RATE = 24000;
const FRAME_SAMPLES = 240;
/** How far ahead of playout frames are handed to the native queue. */
const LEAD_MS = 300;
/** The native queue: comfortably above the lead, so a handoff never waits. */
const QUEUE_MS = 500;

/** TTS audio in whole 10 ms frames, the last padded with silence (ISSUE-454). */
function wholeFrames(pcm: Int16Array) {
  const tail = pcm.length % FRAME_SAMPLES;
  if (tail === 0) return pcm;
  const padded = new Int16Array(pcm.length + FRAME_SAMPLES - tail);
  padded.set(pcm);
  return padded;
}

/** A job whose audio can be played: 24 kHz mono, up to a minute, before a finite stop. */
export function playable(job: BotSpeechJob, stopAtMs: number) {
  const { pcm } = job;
  if (
    !(pcm instanceof Int16Array) ||
    pcm.length === 0 ||
    pcm.length > SAMPLE_RATE * 60 ||
    !Number.isFinite(stopAtMs)
  )
    throw createAppError('VALIDATION');
  return job;
}

/** A phrase as the publisher's step decides on it. */
export const phraseOf = (job: BotSpeechJob): PhraseFacts => ({
  id: job.phraseId,
  text: job.text,
  durationMs: wholeFrames(job.pcm).length / (SAMPLE_RATE / 1000),
  samples: job.pcm.length,
});

/** Joins a room on a fresh track: a retired room is never rejoined (ADR 0110). */
export async function joinTrack(input: {
  readonly verify: () => Promise<unknown>;
  readonly grant: () => Promise<{
    url: string;
    token: string;
    roomName: string;
  }>;
  readonly connect: typeof createAudioPublication;
  /** Named as it connects: the name is minted only once the grant is in hand. */
  readonly trackName: () => string;
}) {
  await input.verify();
  const grant = await input.grant();
  const track = await input.connect({
    url: grant.url,
    token: grant.token,
    trackName: input.trackName(),
    sampleRate: SAMPLE_RATE,
    channels: 1,
    queueMs: QUEUE_MS,
  });
  return { track, room: grant.roomName };
}

/** Streams a phrase's frames, `LEAD_MS` ahead of playout, never one past `stopAtMs`. */
export function streamPhrase(
  clock: Clock,
  target: Publication,
  pcm: Int16Array,
  signal: AbortSignal,
  stopAtMs: number,
): Promise<Written> {
  const write = createStreamingAudioWriter({
    target,
    sampleRate: SAMPLE_RATE,
    channels: 1,
    nowMs: clock.monotonicNowMs,
    waitUntilMs: clock.waitUntilMs,
    leadMs: LEAD_MS,
  });
  return write(wholeFrames(pcm), signal, stopAtMs);
}

/** One store call, as the publisher's step asked for it. */
export function storeCall(
  store: Input['store'],
  {
    scope,
    token,
  }: { readonly scope: BotPublicationScope; readonly token: string },
  args: StoreCall,
) {
  switch (args.kind) {
    case 'begin':
      return store.beginRoundBotPhrase(scope, token, args.phrase, args.room);
    case 'reveal': {
      const { phrase, room, startedAt } = args;
      return store.revealRoundBotPhrase(scope, token, phrase, room, startedAt);
    }
    case 'end':
      return store.endRoundBotPhrase(scope, token, args.phraseId, args.end);
    case 'floor':
      return store.watchRoundBotFloor(scope, token, args.room);
  }
}
