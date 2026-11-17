import { z } from 'zod';
import {
  formFields,
  refused,
  type FormFields,
  type FormValues,
  type Idle,
  type Moved,
  type Refused,
} from '../forms/form-state';

/** The settings as the server prepared them. */
type RoomDraftPreviewed = {
  readonly kind: 'previewed';
  readonly values: FormValues;
};
/** Settings the catalog refuses, to edit again. */
type RoomDraftInvalid = {
  readonly kind: 'invalid';
  readonly values: FormValues;
  readonly error: string;
};
/** The create-room editor's answer: a preview, a refusal, or the Room to go to. */
export type RoomDraftAnswer =
  Idle | Refused | RoomDraftPreviewed | RoomDraftInvalid | Moved;

const values = z.record(z.string().max(100), z.string().max(131072));

export const roomDraftAnswerSchema: z.ZodType<RoomDraftAnswer> =
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('idle'), values }),
    z.object({ kind: z.literal('refused'), values, error: z.string() }),
    z.object({ kind: z.literal('previewed'), values }),
    z.object({ kind: z.literal('invalid'), values, error: z.string() }),
    z.object({
      kind: z.literal('moved'),
      next: z
        .string()
        .regex(/^\/(?:rooms\/[a-z0-9]{24}|rounds\/[a-z0-9]{24}\/room)$/),
    }),
  ]);

/** What the editor renders from each answer. */
export function roomDraftFields(answer: RoomDraftAnswer): FormFields {
  switch (answer.kind) {
    case 'previewed':
      return { values: answer.values, error: undefined };
    case 'invalid':
      return { values: answer.values, error: answer.error };
    case 'idle':
    case 'refused':
    case 'moved':
      return formFields(answer);
  }
}

/** Transport failures keep the exact submitted draft in the editor. */
export async function postRoomDraft(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  form: FormData,
): Promise<RoomDraftAnswer> {
  try {
    const response = await fetch('/play/room/submit', {
      method: 'POST',
      body: form,
      headers: { accept: 'application/json' },
    });
    if (response.ok) return roomDraftAnswerSchema.parse(await response.json());
  } catch {
    // The same retained-draft answer covers failed transport and malformed replies.
  }
  return refused(form, 'Unable to create the room. Try again.');
}
