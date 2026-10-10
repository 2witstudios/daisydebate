import type { SearchParams } from '../access/decision';
/** Native pages validate these untrusted channel/search inputs before loading or submitting. */
export type MessagingChannelPageProps = {
  readonly params: Promise<{ channelId: string }>;
  readonly searchParams: Promise<SearchParams>;
};
