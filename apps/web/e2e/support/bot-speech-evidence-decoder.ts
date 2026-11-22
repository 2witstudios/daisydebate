import { z } from 'zod';
import { seatRefSchema, seatKindSchema } from '@daisy/protocol/seats';

const count = z.int().nonnegative();
/** The seat columns a row carries, read back as the one seat they name. */
const seatColumns = {
  seatKind: seatKindSchema,
  side: z.string().nullable(),
  slot: count,
};
const toSeat = <T extends z.infer<z.ZodObject<typeof seatColumns>>>({
  seatKind,
  side,
  slot,
  ...rest
}: T) => ({
  ...rest,
  seat: seatRefSchema.parse(
    seatKind === 'side'
      ? { kind: seatKind, side, slot }
      : { kind: seatKind, slot },
  ),
});
const evidence = z.strictObject({
  runs: z.array(
    z
      .strictObject({
        ...seatColumns,
        kind: z.string().min(1),
        /** The model the run asked for, as recorded. */
        model: z.string().nullable(),
        /** The rules key of the segment the run spoke in; judging has none. */
        segment: z.string().nullable(),
        outcome: z.string().nullable(),
        requests: count,
        inputTokens: count,
        outputTokens: count,
        characters: count,
      })
      .transform(toSeat),
  ),
  /** Each bot's authored lines in played order: lengths and states only. */
  lines: z.array(
    z
      .strictObject({
        ...seatColumns,
        characters: count,
        complete: z.boolean(),
        interrupted: z.boolean(),
      })
      .transform(toSeat),
  ),
});
/** Exact local portable boundary; malformed worker output never becomes evidence. */
export function decodeBotSpeechEvidence(stdout: string) {
  try {
    return evidence.parse(JSON.parse(stdout));
  } catch {
    throw new Error('Invalid bot speech evidence payload');
  }
}
