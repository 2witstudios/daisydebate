/** A signed-in member identity at a fixed origin, for member route handler tests. */
export const origin = 'https://daisy.example';
export const member = {
  state: 'member' as const,
  username: 'me',
  principal: {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  },
};
