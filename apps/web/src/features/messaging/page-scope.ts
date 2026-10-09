import { notFound } from 'next/navigation';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../lib/access';
import type { SearchParams } from '../access/decision';
export type MessagingPageScope = {
  readonly params: Promise<{ channelId: string }>;
  readonly searchParams: Promise<SearchParams>;
};
/** Authenticate before resolving a page identifier; the actual HTTP reader still authorizes its content. */
export async function readMessagingPageChannel(input: MessagingPageScope) {
  await requireAccess('/messages', input.searchParams);
  const channel = idSchema.safeParse((await input.params).channelId);
  if (!channel.success) notFound();
  return channel.data;
}
