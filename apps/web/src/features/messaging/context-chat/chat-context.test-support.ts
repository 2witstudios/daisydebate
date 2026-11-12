import type { ChatContext } from './chat-context';

/** A context for the shared modules' own tests: any owner field, address and name will do. */
export const testChatContext: ChatContext = {
  ownerKey: 'roundId',
  address: (ownerId) => `/api/rounds/${ownerId}/floor`,
  awaitsOpening: true,
  name: 'Round chat',
};
