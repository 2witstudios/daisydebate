import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import type { NativeAttendanceState } from './operations';
const stateSchema = z.strictObject({
  roundId: idSchema,
  recorded: z.array(
    z.strictObject({ segmentId: idSchema, receivedAt: z.iso.datetime() }),
  ),
  targets: z.array(
    z.strictObject({
      segmentId: idSchema,
      openedAt: z.iso.datetime(),
      effectiveDeadline: z.iso.datetime().nullable(),
      commandId: idSchema,
    }),
  ),
});
/** An unavailable or mismatched private read never becomes invented eligibility. */
export async function readNativeAttendanceState(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  roundId: string,
): Promise<NativeAttendanceState | null> {
  try {
    const response = await fetch(`/api/rounds/${roundId}/check-in`, {
      method: 'GET',
    });
    if (!response.ok) return null;
    const state = stateSchema.safeParse(await response.json());
    return state.success && state.data.roundId === roundId ? state.data : null;
  } catch {
    return null;
  }
}
