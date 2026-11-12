import type { ChatContext } from '../context-chat/chat-context';

/** The Round floor as a context chat: its Round on the wire, its address and its name. */
export const roundFloorContext: ChatContext = {
  ownerKey: 'roundId',
  address: (roundId) => `/api/rounds/${roundId}/floor`,
  awaitsOpening: false,
  name: 'Round chat',
};
