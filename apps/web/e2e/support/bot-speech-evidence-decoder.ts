import { z } from 'zod';

const count = z.int().nonnegative();
const role = z.enum(['affirmative', 'negative', 'judge']);
const evidence = z.strictObject({
  runs: z.array(
    z.strictObject({
      role,
      kind: z.string().min(1),
      outcome: z.string().nullable(),
      requests: count,
      inputTokens: count,
      outputTokens: count,
      characters: count,
    }),
  ),
  /** Each bot's authored lines in played order: lengths and states only. */
  lines: z.array(
    z.strictObject({
      role,
      characters: count,
      complete: z.boolean(),
      interrupted: z.boolean(),
    }),
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
