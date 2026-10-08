import type { OpenRouter } from '@daisy/ai-voice';
import { ballotCategories } from '@daisy/protocol';
import type { Clock, IdGenerator } from '@daisy/clock';
import {
  createAiDebateOperations,
  type AiDebateOperations,
} from './operations';
import { createInMemoryRoundStore } from './round-store.test-support';
import type { RoundStore } from './context';

/** A clock the test moves, so the runtime's ticks are deterministic. */
const testClock = (): Clock & {
  readonly advance: (seconds: number) => void;
} => {
  let ms = Date.parse('2026-10-06T09:00:00.000Z');
  return {
    now: () => new Date(ms).toISOString(),
    advance: (seconds) => {
      ms += seconds * 1000;
    },
  };
};

const sequentialIds: IdGenerator = (() => {
  let next = 0;
  return {
    next: () => {
      next += 1;
      return `id-${String(next).padStart(4, '0')}`;
    },
  };
})();

/** A voice layer that answers exactly, recording which calls were made. */
const fakeVoice = (transcribe?: () => Promise<{ text: string }>) => {
  const calls: string[] = [];
  const prompts: string[] = [];
  const voice: OpenRouter = {
    async complete(input: Parameters<OpenRouter['complete']>[0]) {
      prompts.push(JSON.stringify(input.messages));
      calls.push('complete');
      return {
        text: JSON.stringify({
          rubricVersion: 'speaker-10@1',
          winner: 'affirmative',
          scores: {
            affirmative: Object.fromEntries(
              ballotCategories.map((category) => [category, 4]),
            ),
            negative: Object.fromEntries(
              ballotCategories.map((category) => [category, 3]),
            ),
          },
          reason: 'The affirmative carried its case.',
          feedback: {
            affirmative: 'Keep the through-line.',
            negative: 'Answer the case directly.',
          },
        }),
        promptTokens: 10,
        completionTokens: 10,
      };
    },
    async *stream() {
      calls.push('stream');
      yield 'A short speech.';
    },
    async speak() {
      calls.push('speak');
      return { audio: new ArrayBuffer(4) };
    },
    async transcribe() {
      calls.push('transcribe');
      return transcribe ? transcribe() : { text: 'I affirm.' };
    },
  } as unknown as OpenRouter;
  return { voice: () => voice, calls, prompts };
};

/**
 * An in-memory RoundStore with the operations' real write semantics — the
 * version check, the command dedupe, the seat uniqueness, the first ballot
 * — so the application operations run their full flows against rows
 * exactly as the adapter would persist them. Nothing here decides domain
 * rules: the operations drive the real runtime.
 */
/**
 * The full application operations over the in-memory store, with a movable
 * clock and a scripted voice; `begin` starts one of the actor's debates.
 */
export function setup(
  limits?: {
    readonly live: number;
    readonly perDay: number;
  },
  transcribe?: () => Promise<{ text: string }>,
) {
  const memory = createInMemoryRoundStore();
  const clock = testClock();
  const { voice, calls, prompts } = fakeVoice(transcribe);
  // The fake database's clock is the test's: the operations read the
  // database instant exactly as production reads PostgreSQL's.
  const store = {
    ...memory.store,
    databaseNow: async () => clock.now(),
  } as RoundStore;
  const operations = createAiDebateOperations({
    store,
    voice,
    ids: sequentialIds,
    ...(limits ? { limits } : {}),
  });
  const begin = async () => {
    const { id } = await operations.start({
      actorId: 'actor-1',
      resolution: '  Social   media does more harm than good  ',
      personSide: 'affirmative',
      opponent: 'wren',
    });
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'start' },
      expectedVersion: 1,
    });
    return id;
  };
  return { operations, begin, memory, clock, calls, prompts, store };
}

/** The person speaks their opening constructive through the transcribe path. */
export const speakOpeningConstructive = async (
  operations: AiDebateOperations,
  clock: { readonly advance: (seconds: number) => void },
  id: string,
) => {
  clock.advance(11); // the AC opens: the person's speech
  await operations.transcribe({
    actorId: 'actor-1',
    id,
    segmentIndex: 0,
    audioBase64: 'QUJDRA==',
    format: 'webm',
  });
};

/** Yield the opening constructive and move the injected clock into CX1. */
export const openFirstCrossExamination = async (
  operations: AiDebateOperations,
  clock: { readonly advance: (seconds: number) => void },
  id: string,
) => {
  clock.advance(11);
  const view = await operations.view({ actorId: 'actor-1', id });
  await operations.command({
    actorId: 'actor-1',
    id,
    command: { type: 'yield', segmentIndex: 0 },
    expectedVersion: view.version,
  });
  clock.advance(11);
};
