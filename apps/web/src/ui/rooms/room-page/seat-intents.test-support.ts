import { idle } from '../../../features/forms/form-state';
/** Native seat intents for six declared seats; identities name their seat index. */
export const seatIntents = {
  action: async () => idle(),
  commandIds: Array.from({ length: 6 }, (_, index) => ({
    claim: `claim-${index}`,
    assign: `assign-${index}`,
    remove: `remove-${index}`,
    ai: `ai-${index}`,
  })),
};
