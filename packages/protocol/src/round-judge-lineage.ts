import { z } from 'zod';
import { idSchema } from './primitives';
import type { SeatRef } from './seats';

const assignment = z
  .strictObject({
    version: z.int().positive(),
    participantId: idSchema.nullable(),
    actorId: idSchema.nullable(),
    source: z.enum(['initial', 'observed', 'command']),
    commandId: idSchema.nullable(),
    /** For observed history this is the observation instant, never an inferred old assignment time. */
    recordedAt: z.iso.datetime(),
  })
  .superRefine((row, ctx) => {
    if (
      (row.participantId === null) !== (row.actorId === null) ||
      (row.source === 'command') !== (row.commandId !== null) ||
      (row.version === 1
        ? row.source === 'command' || row.participantId === null
        : row.source !== 'command')
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'An assignment preserves its actual occupant and observation or command provenance',
      });
  });
/** Each slot carries exactly its immutable prefix selected by the terminal witness. */
export const roundJudgeLineageSchema = z.array(
  z.strictObject({
    slot: z.int().nonnegative(),
    versions: z.array(assignment).min(1),
  }),
);
export type RoundJudgeLineage = z.infer<typeof roundJudgeLineageSchema>;

/** The last version of each frozen slot is the terminal cast, independently of later current authority. */
export const terminalJudgeLineageMatches = (
  lineage: RoundJudgeLineage,
  judges: number,
  cast: readonly {
    readonly participantId: string;
    readonly actorId: string;
    readonly seat: SeatRef;
  }[],
): boolean => {
  if (lineage.length !== judges) return false;
  const identities = lineage.flatMap((slot) =>
    slot.versions.flatMap((row) =>
      row.participantId ? [row.participantId] : [],
    ),
  );
  return (
    new Set(identities).size === identities.length &&
    lineage.every((slot, index) => {
      const terminal = slot.versions.at(-1),
        person = cast.find(
          (row) => row.seat.kind === 'judge' && row.seat.slot === slot.slot,
        );
      return (
        slot.slot === index &&
        slot.versions.every((row, ordinal) => row.version === ordinal + 1) &&
        terminal !== undefined &&
        terminal.participantId !== null &&
        person !== undefined &&
        terminal.participantId === person.participantId &&
        terminal.actorId === person.actorId
      );
    })
  );
};
