import { z } from 'zod';
import { debateSideSchema } from './primitives';

/**
 * The case map (ADR 0125): how each side's case is built and how the round's
 * arguments depend on each other, read from the frozen transcript alone. A
 * case is a thesis, the burdens that follow from it and the warrants for each
 * burden; an attack matters by the level it reaches, and a defeated premise
 * removes every argument that depends on it. It is evidence for the final
 * judge, never a ballot, and debaters never see it.
 */
export const caseMapVersion = 'case-map@1';

/**
 * Bounded text. It may be empty: a side that said nothing, or an
 * uncaptured speech, has no claim to state or line to cite.
 */
const text = (max: number) => z.string().trim().max(max);
/** Transcript references as the prompt numbers them: `segment.line`, a range or a short list. */
const line = text(80);
/** A node of a case: A, A1, A1.2 for the affirmative; N, N1, N1.2 for the negative. */
const nodeId = text(32);

const warrantSchema = z.strictObject({
  id: nodeId,
  claim: text(400),
  line,
  kind: z.enum(['reasoning', 'example', 'evidence', 'assertion']),
});
const burdenSchema = z.strictObject({
  id: nodeId,
  claim: text(400),
  line,
  warrants: z.array(warrantSchema).max(12),
});
const caseSchema = z.strictObject({
  thesis: z.strictObject({ id: nodeId, claim: text(400), line }),
  framework: text(1200),
  burdens: z.array(burdenSchema).max(12),
});
const perSide = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ affirmative: schema, negative: schema });

export const caseMapSchema = z.strictObject({
  about: z.strictObject({
    question: text(600),
    affirmative: text(600),
    negative: text(600),
  }),
  cases: perSide(caseSchema),
  framework: z.strictObject({
    dispute: text(1200),
    contested: z
      .array(z.strictObject({ by: debateSideSchema, line, how: text(400) }))
      .max(16),
    ruling: text(1200),
    liveBurdens: z.array(nodeId).max(24),
  }),
  attacks: z
    .array(
      z.strictObject({
        by: debateSideSchema,
        line,
        target: nodeId,
        level: z.enum(['thesis', 'framework', 'burden', 'premise', 'warrant']),
        kind: z.enum([
          'direct',
          'premise',
          'cross-application',
          'turn',
          'concession',
        ]),
        claim: text(400),
        answeredBy: z.array(line).max(12),
        succeeds: z.enum(['yes', 'partly', 'no']),
        why: text(600),
        removes: z
          .array(z.strictObject({ id: nodeId, dependency: text(400) }))
          .max(16),
      }),
    )
    .max(48),
  concessions: z
    .array(
      z.strictObject({
        by: debateSideSchema,
        line,
        quote: text(400),
        limits: text(400),
        bearsOn: nodeId,
        againstOwnCase: z.boolean(),
      }),
    )
    .max(24),
  coherence: perSide(z.array(text(600)).max(12)),
  standing: perSide(z.array(nodeId).max(48)),
});
export type CaseMap = z.infer<typeof caseMapSchema>;
