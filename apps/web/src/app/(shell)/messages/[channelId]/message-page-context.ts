import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { idSchema } from '@daisy/protocol';
import type { MessagingChannelPageProps } from '../../../../features/messaging/channel-page';
/** Attachment and reaction pages share route-selected message scope and incoming participant headers. */
export async function messagePageContext({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  const intent = await searchParams;
  const channel = idSchema.safeParse((await params).channelId),
    message = idSchema.safeParse(intent.messageId);
  if (!channel.success || !message.success) notFound();
  return {
    channelId: channel.data,
    messageId: message.data,
    intent,
    incoming: new Headers(await headers()),
  };
}
