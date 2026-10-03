import type { Clock } from '@daisy/clock';
import { sequentialId } from '@daisy/clock';
import { createAiDebateOperations } from './operations';
import type { AiDebateRecord } from '@daisy/db';
import type { AiDebateStore, AiDebateVoice } from './context';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** An in-memory AI debate store with the database adapter's semantics. */
function memoryStore(): AiDebateStore & {
  readonly records: Map<string, Mutable<AiDebateRecord>>;
} {
  const records = new Map<string, Mutable<AiDebateRecord>>();
  const get = (id: string) => {
    const record = records.get(id);
    if (!record) throw new Error(`no AI debate ${id}`);
    return record;
  };
  return {
    records,
    async createAiDebate(input) {
      records.set(input.id, {
        ...input,
        createdAt: new Date(0),
        countedAt: null,
        finishedAt: null,
        ttsCharacters: 0,
        sttRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        commands: [],
        utterances: [],
        ballot: null,
      });
    },
    async getAiDebate(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async appendAiDebateCommand({ aiDebateId, expectedSequence, command }) {
      const record = get(aiDebateId);
      if (record.commands.length !== expectedSequence)
        throw Object.assign(new Error('moved on'), { code: 'CONFLICT' });
      record.commands = [...record.commands, command];
    },
    async appendAiDebateUtterance({ id, aiDebateId, turnIndex, role, text }) {
      const record = get(aiDebateId);
      record.utterances = [
        ...record.utterances,
        { id, sequence: record.utterances.length, turnIndex, role, text },
      ];
    },
    async replaceAiDebateUtterance({ id, aiDebateId, text }) {
      const record = get(aiDebateId);
      record.utterances = record.utterances.map((u) =>
        u.id === id ? { ...u, text } : u,
      );
    },
    async recordAiDebateUsage({
      aiDebateId,
      ttsCharacters = 0,
      sttRequests = 0,
      promptTokens = 0,
      completionTokens = 0,
    }) {
      const record = get(aiDebateId);
      record.ttsCharacters += ttsCharacters;
      record.sttRequests += sttRequests;
      record.promptTokens += promptTokens;
      record.completionTokens += completionTokens;
      record.countedAt ??= new Date(1);
    },
    async finishAiDebate(id) {
      get(id).finishedAt ??= new Date(2);
    },
    async saveAiDebateBallot({ aiDebateId, winner, ballot }) {
      const record = get(aiDebateId);
      record.ballot ??= { winner, ballot };
      return record.ballot;
    },
    async countLiveAiDebates() {
      return [...records.values()].filter((r) => r.finishedAt === null).length;
    },
    async countCountedAiDebates({ actorId }) {
      return [...records.values()].filter(
        (r) => r.actorId === actorId && r.countedAt !== null,
      ).length;
    },
  };
}

/** A scripted voice: canned speech, CX replies, transcripts and a ballot. */
export function scriptedVoice({
  speech = 'Thank you, judge. My first contention is safety. I urge an affirmative ballot.',
  reply = 'Is that your strongest example?',
  transcript = 'I think the evidence is clear.',
  ballot = {
    winner: 'affirmative',
    reason: 'The affirmative answered every negative argument.',
    speeches: [],
    tips: ['Signpost more.'],
  },
}: {
  readonly speech?: string;
  readonly reply?: string;
  readonly transcript?: string;
  readonly ballot?: Record<string, unknown>;
} = {}): AiDebateVoice & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async complete(request) {
      calls.push(`complete:${request.model}`);
      return {
        text: request.json ? JSON.stringify(ballot) : reply,
        promptTokens: 10,
        completionTokens: 5,
      };
    },
    async *stream(request) {
      calls.push(`stream:${request.model}`);
      for (const word of speech.split(/(?<= )/)) yield word;
    },
    async speak({ text }) {
      calls.push(`speak:${text}`);
      return { audio: new Uint8Array([7]).buffer, characters: text.length };
    },
    async transcribe() {
      calls.push('transcribe');
      return { text: transcript };
    },
  };
}

const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);
const movableClock = (start = T0) => {
  let now = start;
  const clock: Clock = { now: () => new Date(now).toISOString() };
  return { clock, advance: (seconds: number) => (now += seconds * 1000) };
};

export const setup = ({
  personSide = 'negative',
  voice = scriptedVoice(),
}: {
  personSide?: 'affirmative' | 'negative';
  voice?: ReturnType<typeof scriptedVoice>;
} = {}) => {
  const store = memoryStore();
  const time = movableClock();
  const operations = createAiDebateOperations({
    store,
    voice: () => voice,
    clock: time.clock,
    ids: sequentialId('x'),
  });
  const begin = async () => {
    const { id } = await operations.start({
      actorId: 'actor-1',
      resolution: '  Social media does   more harm than good ',
      personSide,
      voice: 'am_michael',
    });
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'start' },
      expectedSequence: 0,
    });
    return id;
  };
  return { store, time, operations, voice, begin };
};

export const collect = async <T>(source: AsyncIterable<T>) => {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
};
