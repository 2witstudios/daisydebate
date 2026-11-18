import { aiAdmissionOptions } from '../src/server/round-worker-policy';

/** Production bot-debater admission at local proof capacity 4 and the beta cap of 20. */
export const botAdmissionForTests = aiAdmissionOptions({
  AI_ROUND_BUSY_CAP: 4,
  PREMIUM_BETA_GRANT: true,
});
