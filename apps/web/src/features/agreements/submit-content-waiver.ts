import type { RoomView } from '@daisy/protocol';
import { z } from 'zod';
import {
  blankFields,
  done,
  formFields,
  refused,
  unacknowledged,
  type FormFields,
  type Moved,
} from '../forms/form-state';
import {
  roomAccepted,
  roomNoticeQuery,
  type RoomFormState,
} from '../rooms/command-answer';

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

/** The notice a native post takes back to the room for each outcome. */
const noticeQuery = (result: WaiverSubmission): string => {
  switch (result) {
    case 'signed':
      return '';
    case 'refused':
      return roomNoticeQuery({
        kind: 'refused',
        reason: 'content-waiver-required',
      });
    case 'unavailable':
      return roomNoticeQuery({ kind: 'unacknowledged' });
  }
};

/**
 * A hydrated page adopts the room the signature unblocks; a native post goes
 * back to the room, with the notice when nothing was signed. A lost answer
 * may have signed: signing again is the same signature, so it stays
 * retryable.
 */
export function contentWaiverAnswer(
  result: WaiverSubmission,
  roomId: string,
  form: FormData,
  edge: {
    readonly hydrated: boolean;
    readonly view: RoomView | null;
    readonly move: (destination: string) => Moved;
  },
): RoomFormState {
  if (!edge.hydrated)
    return edge.move(`/rooms/${roomId}${noticeQuery(result)}#`);
  switch (result) {
    case 'signed':
      return edge.view ? roomAccepted(edge.view) : done;
    case 'refused':
      return refused(
        form,
        'The waiver was not signed. Review it and try again.',
      );
    case 'unavailable':
      return unacknowledged(form);
  }
}

/**
 * A waiver carries no command identifier and needs none: a member's
 * signature on a season's version is one fact, so sending it again signs
 * nothing new.
 */
const waiverUnacknowledgedText =
  'Your signature may have been recorded. Signing again is safe: a season’s waiver is signed once, however often it is sent.';

/** What the waiver form renders from each answer; the waiver itself always stays. */
export function contentWaiverFields(answer: RoomFormState): FormFields {
  switch (answer.kind) {
    case 'accepted':
      return blankFields;
    case 'unacknowledged':
      return { values: answer.values, error: waiverUnacknowledgedText };
    case 'idle':
    case 'refused':
    case 'done':
    case 'moved':
      return formFields(answer);
  }
}
