import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { parseMessagingFormScope } from './form-scope';
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
