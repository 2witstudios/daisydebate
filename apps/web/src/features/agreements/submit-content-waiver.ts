import type { RoomRefusal, RoomView } from '@daisy/protocol';
import { z } from 'zod';
import { refused } from '../forms/form-state';
import type { RoomFormState } from '../rooms/command-answer';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type WaiverSubmission = 'signed' | 'refused' | 'unavailable';

/** Posts a native form's fields; the handler validates them again. */
export async function submitContentWaiver(
  fetch: FetchLike,
  form: FormData,
): Promise<WaiverSubmission> {
  try {
    const response = await fetch('/api/agreements/content-waiver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: form.get('version'),
        accepted: form.get('accepted'),
      }),
    });
    if (response.ok)
      return z
        .object({ signed: z.literal(true) })
        .safeParse(await response.json()).success
        ? 'signed'
        : 'unavailable';
    return response.status >= 500 ? 'unavailable' : 'refused';
  } catch {
    return 'unavailable';
  }
}

const refusedReason: RoomRefusal = 'content-waiver-required';

/**
 * A hydrated page adopts the room the signature unblocks; a native post goes
 * back to the room, with the notice when nothing was signed.
 */
export function contentWaiverAnswer(
  result: WaiverSubmission,
  roomId: string,
  form: FormData,
  edge: {
    readonly hydrated: boolean;
    readonly view: RoomView | null;
    readonly move: (destination: string) => { readonly next: string };
  },
): RoomFormState {
  if (!edge.hydrated)
    return {
      values: {},
      ...edge.move(
        result === 'signed'
          ? `/rooms/${roomId}#`
          : `/rooms/${roomId}?notice=command-refused&reason=${refusedReason}#`,
      ),
    };
  if (result !== 'signed')
    return refused(form, 'The waiver was not signed. Review it and try again.');
  return edge.view ? { values: {}, view: edge.view } : { values: {} };
}
