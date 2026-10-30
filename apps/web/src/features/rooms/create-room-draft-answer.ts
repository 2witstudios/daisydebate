import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { roomDraftAnswerSchema } from './create-room-answer';
import type { FormState } from '../forms/form-state';

const answerSchema = z.object({
  commandId: idSchema,
  source: idSchema.nullable(),
  state: roomDraftAnswerSchema,
});
type Store = {
  readonly setEphemeral: (
    key: string,
    value: string,
    ttlSeconds: number,
  ) => Promise<void>;
  readonly get: (key: string) => Promise<string | null>;
};
const key = (userId: string) => `roomdraft-${idSchema.parse(userId)}`;

/** One bounded, five-minute native form answer per member; never competitive state. */
export async function saveRoomDraftAnswer(
  store: Store,
  userId: string,
  commandId: string,
  source: string | null,
  state: FormState,
) {
  const answer = answerSchema.parse({ commandId, source, state });
  await store.setEphemeral(key(userId), JSON.stringify(answer), 300);
}

export async function readRoomDraftAnswer(
  store: Store,
  userId: string,
  commandId: unknown,
  source: string | null,
): Promise<FormState> {
  if (!idSchema.safeParse(commandId).success) return { values: {} };
  const stored = await store.get(key(userId));
  if (!stored)
    return {
      values: {},
      error: 'This settings preview expired. Choose your settings again.',
    };
  let answer: z.infer<typeof answerSchema>;
  try {
    answer = answerSchema.parse(JSON.parse(stored));
  } catch {
    return { values: {} };
  }
  return answer.commandId === commandId && answer.source === source
    ? {
        values: answer.state.values,
        ...(answer.state.error ? { error: answer.state.error } : {}),
      }
    : {
        values: {},
        error: 'This settings preview expired. Choose your settings again.',
      };
}

/** The member's own unsubmitted draft joins their data export without exposing another member's key. */
export async function exportRoomDraftAnswer(
  store: Store,
  userId: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const raw = await store.get(key(userId));
  if (!raw) return [];
  const answer = answerSchema.safeParse(JSON.parse(raw));
  return answer.success ? [answer.data.state.values] : [];
}

/** Cache deletion precedes account closure; an outage refuses closure for retry. */
export async function eraseRoomDraftAnswer(
  store: { readonly delete: (key: string) => Promise<void> },
  userId: string,
) {
  await store.delete(key(userId));
}
