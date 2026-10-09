import { isAppError } from '@daisy/errors';
export type MessagingInboxEntry = {
  readonly channelId: string;
  readonly kind: 'conversation' | 'incoming_request' | 'outgoing_request';
};
export async function readMessagingInbox(
  input: { readonly limit: number; readonly after?: string },
  port: {
    readonly candidates: (input: {
      readonly limit: number;
      readonly after?: string;
    }) => Promise<readonly string[]>;
    readonly inspect: (channelId: string) => Promise<MessagingInboxEntry>;
  },
) {
  const candidates = await port.candidates(input);
  const entries: MessagingInboxEntry[] = [];
  for (const channelId of candidates) {
    try {
      entries.push(await port.inspect(channelId));
    } catch (error) {
      if (
        !isAppError(error) ||
        !['AUTHORIZATION', 'NOT_FOUND', 'CONFLICT'].includes(error.code)
      )
        throw error;
    }
  }
  return {
    entries,
    nextAfter:
      candidates.length === input.limit ? (candidates.at(-1) ?? null) : null,
  };
}
