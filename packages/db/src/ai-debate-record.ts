import type { aiDebateBallots, aiDebateCommands } from './schema/ai-debates';

export type AiDebateSide = 'affirmative' | 'negative';

export type AiDebateCommandRecord =
  | { readonly type: 'start'; readonly at: Date }
  | { readonly type: 'startSpeech'; readonly at: Date }
  | { readonly type: 'yield'; readonly at: Date; readonly turnIndex: number }
  | {
      readonly type: 'abort';
      readonly at: Date;
      readonly reason: 'person' | 'vendor-failure';
    };

export type AiDebateUtteranceRecord = {
  readonly id: string;
  readonly sequence: number;
  readonly turnIndex: number;
  readonly role: 'person' | 'ai';
  readonly text: string;
};

export type NewAiDebate = {
  readonly id: string;
  readonly actorId: string;
  readonly resolution: string;
  readonly personSide: AiDebateSide;
  /** The Train bot debated. */
  readonly opponent: string;
  readonly voice: string;
  readonly speechModel: string;
  readonly cxModel: string;
  readonly judgeModel: string;
  readonly ttsModel: string;
  readonly sttModel: string;
  readonly expectedEndAt: Date;
};

export type AiDebateRecord = NewAiDebate & {
  readonly createdAt: Date;
  readonly countedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly ttsCharacters: number;
  readonly sttRequests: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly commands: readonly AiDebateCommandRecord[];
  readonly utterances: readonly AiDebateUtteranceRecord[];
  readonly ballot: {
    readonly winner: AiDebateSide;
    readonly ballot: BallotJson;
  } | null;
};

type CommandRow = typeof aiDebateCommands.$inferSelect;
/** A JSON object, as the ballot column stores it. */
export type BallotJson = (typeof aiDebateBallots.$inferSelect)['ballot'];

export const toCommand = (row: CommandRow): AiDebateCommandRecord => {
  if (row.type === 'yield')
    return { type: 'yield', at: row.at, turnIndex: row.turnIndex ?? 0 };
  if (row.type === 'abort')
    return {
      type: 'abort',
      at: row.at,
      reason: row.reason === 'vendor-failure' ? 'vendor-failure' : 'person',
    };
  return {
    type: row.type === 'startSpeech' ? 'startSpeech' : 'start',
    at: row.at,
  };
};
