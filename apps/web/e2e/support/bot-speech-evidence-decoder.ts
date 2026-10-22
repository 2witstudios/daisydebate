import { z } from 'zod';

const count = z.int().nonnegative();
const evidence = z.array(
  z.strictObject({
    role: z.enum(['affirmative', 'negative', 'judge']),
    kind: z.string().min(1),
    outcome: z.string().nullable(),
    requests: count,
    inputTokens: count,
    outputTokens: count,
    characters: count,
  }),
);
/** Exact local portable boundary; malformed worker output never becomes evidence. */
export function decodeBotSpeechEvidence(stdout: string) {
  try {
    return evidence.parse(JSON.parse(stdout));
  } catch {
    throw new Error('Invalid bot speech evidence payload');
  }
}
