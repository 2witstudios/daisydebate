import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
/** Bound scope and the idempotency field both round-trip through an untrusted form. */
export function parseMessagingFormScope(channel: unknown, input: unknown) {
  if (!(input instanceof FormData)) throw createAppError('VALIDATION');
  const channelId = idSchema.safeParse(channel);
  const requestId = idSchema.safeParse(input.get('requestId'));
  if (
    !channelId.success ||
    !requestId.success ||
    input.getAll('requestId').length !== 1
  )
    throw createAppError('VALIDATION');
  return { form: input, channelId: channelId.data, requestId: requestId.data };
}
export const formRequestId = (form: FormData) =>
  typeof form.get('requestId') === 'string'
    ? String(form.get('requestId'))
    : '';
