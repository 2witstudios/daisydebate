import { z } from 'zod';
import { debateSideSchema, idSchema } from './primitives';

const instant = z.iso.datetime({ offset: true });
const count = z.int().nonnegative();

/**
 * What one completed Round means for one debater's record. `no-ruling` is a
 * completed Round nobody won or drew: it is listed, never counted.
 */
export const recordResults = ['win', 'loss', 'draw', 'no-ruling'] as const;
export type RecordResult = (typeof recordResults)[number];

/** Who ruled a Round: AI judges, human judges, both, or nobody. */
export const judgePanels = ['ai', 'human', 'mixed', 'none'] as const;
export type JudgePanel = (typeof judgePanels)[number];

/** A debater's unrated record: no rating, only what completed Rounds decided. */
export const debateRecordSchema = z.strictObject({
  wins: count,
  losses: count,
  draws: count,
});
export type DebateRecord = z.infer<typeof debateRecordSchema>;

/** One completed Round in a debater's history, from that debater's seat. */
export const matchHistoryEntrySchema = z.strictObject({
  roundId: idSchema,
  completedAt: instant,
  resolution: z.string().min(1),
  side: debateSideSchema,
  /** The other side's seats; a null label is a member who has left Daisy. */
  opponents: z
    .array(
      z.strictObject({
        kind: z.enum(['human', 'bot']),
        label: z.string().min(1).nullable(),
      }),
    )
    .readonly(),
  result: z.enum(recordResults),
  /** The Round ended because a debater forfeited, not by a ruling. */
  forfeit: z.boolean(),
  judges: z.enum(judgePanels),
  visibility: z.enum(['public', 'unlisted', 'private']),
});
export type MatchHistoryEntry = z.infer<typeof matchHistoryEntrySchema>;

/** The history page a profile asks for: newest first, after `before`. */
export const matchHistoryQuerySchema = z.strictObject({
  before: idSchema.optional(),
});
export type MatchHistoryQuery = z.infer<typeof matchHistoryQuerySchema>;

/**
 * A member's profile as one viewer may see it (ISSUE-600): the history
 * lists every Round to the member themself and only public Rounds to
 * anyone else. The record counts every completed Round either way.
 */
export const memberProfileSchema = z.strictObject({
  version: z.literal(1),
  username: z.string().min(1),
  memberSince: instant,
  me: z.boolean(),
  record: debateRecordSchema,
  history: z.array(matchHistoryEntrySchema).readonly(),
  /** The `before` cursor of the next, older page; null on the last page. */
  nextBefore: idSchema.nullable(),
});
export type MemberProfile = z.infer<typeof memberProfileSchema>;
