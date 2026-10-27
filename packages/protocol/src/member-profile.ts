import { z } from 'zod';
import { idSchema, type DebateSide } from './primitives';

/** What one completed Round means for one debater's record. */
export type RecordResult = 'win' | 'loss' | 'draw' | 'no-ruling';

/** Who ruled a Round: AI judges, human judges, both, or nobody. */
export type JudgePanel = 'ai' | 'human' | 'mixed' | 'none';

/** A debater's unrated record: no rating, only what completed Rounds decided. */
export type DebateRecord = {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
};

/** In-process projection from the validated durable rows; no wire consumer. */
export type MatchHistoryEntry = {
  readonly roundId: string;
  readonly completedAt: string;
  readonly resolution: string;
  readonly side: DebateSide;
  /** A null label is a member who has left Daisy. */
  readonly opponents: readonly {
    readonly kind: 'human' | 'bot';
    readonly label: string | null;
  }[];
  readonly result: RecordResult;
  readonly forfeit: boolean;
  readonly judges: JudgePanel;
  readonly visibility: 'public' | 'unlisted' | 'private';
};

/** The history page a profile asks for: newest first, after `before`. */
export const matchHistoryQuerySchema = z.strictObject({
  before: idSchema.optional(),
});
export type MatchHistoryQuery = z.infer<typeof matchHistoryQuerySchema>;

/** Owner scope includes private Rounds; every other viewer sees public only. */
export type MemberProfile = {
  readonly version: 1;
  readonly username: string;
  readonly memberSince: string;
  readonly me: boolean;
  readonly record: DebateRecord;
  readonly history: readonly MatchHistoryEntry[];
  readonly nextBefore: string | null;
};
