/** Native seat intents for six declared seats; identities name their seat index. */
export const seatIntents = {
  action: async () => ({ values: {} }),
  commandIds: Array.from({ length: 6 }, (_, index) => ({
    claim: `claim-${index}`,
    assign: `assign-${index}`,
    remove: `remove-${index}`,
    ai: `ai-${index}`,
  })),
};
