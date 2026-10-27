import { botAdmissionOptions } from '../src/server/round-worker-policy';

/** Production bot-debater admission at local proof capacity 4 and the beta cap of 20. */
export const botAdmissionForTests = botAdmissionOptions({
  AI_ROUND_BUSY_CAP: 4,
  AI_ROUND_MONTHLY_CAP: 20,
});
