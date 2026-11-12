import type { ChatContext } from '../context-chat/chat-context';

/** Room chat as a context chat: its Room on the wire, its address and its name. */
export const roomChatContext: ChatContext = {
  ownerKey: 'roomId',
  address: (roomId) => `/api/rooms/${roomId}/chat`,
  name: 'Room chat',
};
