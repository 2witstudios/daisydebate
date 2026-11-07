import { init } from '@paralleldrive/cuid2';
import { randomInt } from 'node:crypto';

/** Fresh object namespace, never an authorization token or durable capture epoch. */
export const createSubscriptionIncarnation = init({
  random: () => randomInt(0x100000000) / 0x100000000,
});
