import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { Idle, Moved, Refused } from '../../forms/form-state';
import { formRequestId, parseMessagingFormScope } from './form-scope';

/** The request a reaction change posts under. */
type ReactionValues = { readonly values: { readonly requestId: string } };
export type ReactionRefused = Refused & ReactionValues;

/** A reaction form's answer. */
export type ReactionFormState =
  (Idle & ReactionValues) | ReactionRefused | Moved;

export const reactionIdle = (requestId: string): ReactionFormState => ({
  kind: 'idle',
  values: { requestId },
});

export const reactionUnavailable = (form: FormData): ReactionRefused => ({
  kind: 'refused',
  values: { requestId: formRequestId(form) },
  error: 'Reaction could not be changed. Try again.',
});

/** What a reaction form renders. */
export type ReactionFields = {
  readonly requestId: string;
  readonly notice: string | undefined;
};

export function reactionFields(answer: ReactionFormState): ReactionFields {
  switch (answer.kind) {
    case 'idle':
      return { requestId: answer.values.requestId, notice: undefined };
    case 'refused':
      return { requestId: answer.values.requestId, notice: answer.error };
    case 'moved':
      return { requestId: '', notice: undefined };
  }
}

/** Native forms carry intent; authority comes from current transaction facts. */
export function parseReactionForm(
  channel: unknown,
  message: unknown,
  input: unknown,
) {
  const { form, channelId, requestId } = parseMessagingFormScope(
    channel,
    input,
  );
  const messageId = idSchema.safeParse(message);
  const reaction = form.get('reaction'),
    active = form.get('active');
  if (
    !messageId.success ||
    typeof reaction !== 'string' ||
    !['true', 'false'].includes(String(active)) ||
    form.getAll('reaction').length !== 1 ||
    form.getAll('active').length !== 1
  )
    throw createAppError('VALIDATION');
  return {
    version: 1 as const,
    channelId,
    messageId: messageId.data,
    requestId,
    reaction,
    active: active === 'true',
  };
}
