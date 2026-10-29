import { z } from 'zod';
import { formValues, type FormState } from '../forms/form-state';

export const roomDraftAnswerSchema = z
  .object({
    values: z.record(z.string().max(100), z.string().max(131072)),
    error: z.string().optional(),
    next: z
      .string()
      .regex(/^\/rooms\/[a-z0-9]{24}$/)
      .optional(),
  })
  .transform((answer): FormState => ({
    values: answer.values,
    ...(answer.error === undefined ? {} : { error: answer.error }),
    ...(answer.next === undefined ? {} : { next: answer.next }),
  }));

/** Transport failures keep the exact submitted draft in the editor. */
export async function postRoomDraft(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  form: FormData,
): Promise<FormState> {
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
  return {
    values: formValues(form),
    error: 'Unable to create the room. Try again.',
  };
}
