import { z } from 'zod';
import {
  publishedResolutionSchema,
  type PublishedResolution,
} from '@daisy/protocol';
import {
  formFields,
  refused,
  type FormFields,
  type FormValues,
  type Idle,
  type Moved,
  type Refused,
} from '../forms/form-state';

/** The settings as the server prepared them, with the catalog it read them against. */
type RoomDraftPreviewed = {
  readonly kind: 'previewed';
  readonly values: FormValues;
  readonly resolutions: readonly PublishedResolution[];
};
/** Settings the catalog refuses, with that catalog to choose from again. */
type RoomDraftInvalid = {
  readonly kind: 'invalid';
  readonly values: FormValues;
  readonly error: string;
  readonly resolutions: readonly PublishedResolution[];
};
/** The create-room editor's answer: a preview, a refusal, or the Room to go to. */
export type RoomDraftAnswer =
  Idle | Refused | RoomDraftPreviewed | RoomDraftInvalid | Moved;

const values = z.record(z.string().max(100), z.string().max(131072));
const resolutions = z.array(publishedResolutionSchema).readonly();

export const roomDraftAnswerSchema: z.ZodType<RoomDraftAnswer> =
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('idle'), values }),
    z.object({ kind: z.literal('refused'), values, error: z.string() }),
    z.object({ kind: z.literal('previewed'), values, resolutions }),
    z.object({
      kind: z.literal('invalid'),
      values,
      error: z.string(),
      resolutions,
    }),
    z.object({
      kind: z.literal('moved'),
      next: z
        .string()
        .regex(/^\/(?:rooms\/[a-z0-9]{24}|rounds\/[a-z0-9]{24}\/room)$/),
    }),
  ]);

/** What the editor renders from each answer, and the catalog it brought, if any. */
export function roomDraftFields(answer: RoomDraftAnswer): FormFields & {
  readonly resolutions: readonly PublishedResolution[] | undefined;
} {
  switch (answer.kind) {
    case 'previewed':
      return {
        values: answer.values,
        error: undefined,
        resolutions: answer.resolutions,
      };
    case 'invalid':
      return {
        values: answer.values,
        error: answer.error,
        resolutions: answer.resolutions,
      };
    case 'idle':
    case 'refused':
    case 'moved':
      return { ...formFields(answer), resolutions: undefined };
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
