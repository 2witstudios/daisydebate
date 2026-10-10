import { messagingGroupCreationResultSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
export function messagingGroupResultView(result: unknown, channelId: string) {
  const parsed = messagingGroupCreationResultSchema.safeParse(result);
  if (!parsed.success || parsed.data.channelId !== channelId)
    throw createAppError('INFRASTRUCTURE');
  return parsed.data;
}
