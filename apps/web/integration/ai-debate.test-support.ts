import { systemId } from '@daisy/clock';
import type { Database } from '@daisy/db';
import {
  practiceRoomConfig,
  referenceAiJudge,
} from '@daisy/db/reference-formats';
import { createAiDebateOperations } from '../src/features/ai-debate/operations';
import type { AiDebateDependencies } from '../src/features/ai-debate/context';
import { opponentFor } from '../src/features/ai-debate/opponents';
import { withRoomRuntime } from './room-runtime.test-support';
type Voice = ReturnType<AiDebateDependencies['voice']>;
/** Existing bot runtime proof starts from the same canonical persisted Room Launch. */
export const withPractice = async (
  run: (fixture: {
    database: Database;
    actorId: string;
    id: string;
    operations: ReturnType<typeof createAiDebateOperations>;
    expireAt: (seconds: number) => Promise<void>;
    setTranscribe: (work: Voice['transcribe']) => void;
  }) => Promise<void>,
  {
    personSide = 'affirmative',
    voiceOverrides = {},
  }: {
    readonly personSide?: 'affirmative' | 'negative';
    readonly voiceOverrides?: Partial<Voice>;
  } = {},
) =>
  withRoomRuntime(async (f) => {
    const actorId = f.host.actorId;
    let view = (
      await f.create({
        visibility: 'private',
        selection: {
          kind: 'catalog',
          formatId: 'one-on-one',
          formatVersion: 1,
          length: 'full',
          competitionType: 'practice',
          config: practiceRoomConfig,
        },
      })
    ).view;
    view = (
      await f.command(f.host, view, {
        type: 'claim-seat',
        role: personSide,
        slot: 0,
      })
    ).view;
    view = (
      await f.command(f.host, view, {
        type: 'assign-seat',
        actorId: opponentFor('wren')!.actorId,
        role: personSide === 'affirmative' ? 'negative' : 'affirmative',
        slot: 0,
      })
    ).view;
    view = (
      await f.command(f.host, view, {
        type: 'assign-seat',
        actorId: referenceAiJudge.actorId,
        role: 'judge',
        slot: 0,
      })
    ).view;
    view = (
      await f.command(f.host, view, {
        type: 'ready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === actorId,
        )!.consentVersion,
      })
    ).view;
    view = (await f.command(f.host, view, { type: 'start-round' })).view;
    const id = view.roundRef!.id;
    let transcribe: Voice['transcribe'] = async () => ({
      text: 'My final words.',
    });
    const unused = async (): Promise<never> => {
      throw new Error('unexpected voice call');
    };
    const voice: Voice = {
      transcribe: (input) => transcribe(input),
      complete: unused,
      speak: unused,
      async *stream() {
        yield await unused();
      },
      ...voiceOverrides,
    };
    const operations = createAiDebateOperations({
      store: f.store,
      voice: () => voice,
      ids: systemId,
    });
    await operations.command({
      actorId,
      id,
      command: { type: 'start' },
      expectedVersion: 1,
    });
    await run({
      database: f.store,
      actorId,
      id,
      operations,
      expireAt: async (seconds) => {
        await f.sql`update rounds set started_at = statement_timestamp() - (${seconds} * interval '1 second') where id = ${id}`;
      },
      setTranscribe: (work) => {
        transcribe = work;
      },
    });
  });
