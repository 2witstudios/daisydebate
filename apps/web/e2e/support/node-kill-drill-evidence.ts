import { z } from 'zod';
import { executeLaunchEvidence } from './launch-evidence-worker';

const instant = z.iso.datetime();
const evidenceSchema = z.object({
  status: z.string(),
  observedAt: instant,
  sessions: z.array(
    z.object({
      unsafeAt: instant.nullable(),
      lastPassClean: z.boolean(),
      endedAt: instant.nullable(),
    }),
  ),
  segments: z.array(
    z.object({
      id: z.string(),
      startedAt: instant,
      endedAt: instant.nullable(),
      durationMs: z.number(),
    }),
  ),
  grants: z.array(
    z.object({
      segmentId: z.string(),
      participantId: z.string(),
      startedAt: instant,
      endedAt: instant.nullable(),
    }),
  ),
  observations: z.array(
    z.object({
      segmentId: z.string(),
      participantId: z.string(),
      from: instant,
      until: instant,
    }),
  ),
  adjudications: z.array(z.object({ decision: z.string() })),
  incidents: z.number().nullable(),
  resumePoints: z.array(z.string()),
  returnedMs: z.number(),
});
export type DrillEvidence = z.infer<typeof evidenceSchema>;

export const drillEvidence = async (roundId: string) =>
  evidenceSchema.parse(
    JSON.parse(
      await executeLaunchEvidence(
        'node-kill-drill-evidence-process.ts',
        roundId,
      ),
    ),
  );
