/** What each chat refusal says. The words are fixed; nothing comes from the URL. */
export const chatRefusalText: Readonly<Record<string, string>> = {
  'chat-unavailable': 'This Round has no chat.',
  'chat-closed': 'Chat has closed for this Round.',
  'chat-banned': 'You cannot post to spectator chat.',
  'chat-slow-mode': 'Slow mode is on. Wait a moment and post again.',
  'chat-needs-username': 'Choose a username before you post.',
};

export const CHAT_POST_FAILED = 'Could not post that. Your message is kept.';
