import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { PublicCheckInProbeConfiguration } from './public-probe';
const probeConfiguration = z.strictObject({
  origin: z.url(),
  roundId: idSchema,
  segmentId: idSchema,
  participantId: idSchema,
  cookie: z.string().min(1).max(16384),
});
/** Process edge reads ATTENDANCE_PUBLIC_PROBE once; this pure parser never includes credential data in errors. */
export function readPublicCheckInProbe(
  raw: string | undefined,
): PublicCheckInProbeConfiguration | null {
  if (raw === undefined) return null;
  try {
    const parsed = probeConfiguration.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    throw createAppError(
      'VALIDATION',
      'Invalid attendance public-probe configuration',
    );
  }
  throw createAppError(
    'VALIDATION',
    'Invalid attendance public-probe configuration',
  );
}
