import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import {
  unavailableRead,
  type UnavailableRead,
} from '../../server/temporary-read';
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
/** A native attendance read's answer; asking again helps only a temporary one. */
export type NativeAttendanceRead =
  | { readonly kind: 'found'; readonly state: NativeAttendanceState }
  | UnavailableRead;

/** An unavailable or mismatched private read never becomes invented eligibility. */
export async function readNativeAttendanceState(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  roundId: string,
): Promise<NativeAttendanceRead> {
  try {
    const response = await fetch(`/api/rounds/${roundId}/check-in`, {
      method: 'GET',
    });
    if (!response.ok) return unavailableRead(response);
    const state = stateSchema.safeParse(await response.json());
    return state.success && state.data.roundId === roundId
      ? { kind: 'found', state: state.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
