import { sha3 } from './secrets';

/**
 * Failed authentication is limited per purpose and client (ADR 0076): at
 * most 10 failures per fixed 10-minute window. The client is stored only as
 * SHA3-256 of its address under ADMIN_ATTEMPT_KEY, never raw.
 */
const ATTEMPT_WINDOW_MS = 10 * 60_000;
export const ATTEMPT_LIMIT = 10;
export type AttemptPurpose = 'enroll' | 'sign-in';

export const clientDigest = (attemptKey: string, address: string): string =>
  sha3(`daisy-admin-attempt-v1\n${attemptKey}\n${address}`);

export function attemptWindow(now: string): string {
  const at = Date.parse(now);
  return new Date(at - (at % ATTEMPT_WINDOW_MS)).toISOString();
}

export const attemptBucket = (input: {
  readonly purpose: AttemptPurpose;
  readonly client: string;
  readonly now: string;
}): string => `${input.purpose}:${input.client}:${attemptWindow(input.now)}`;

export const attemptsExhausted = (failures: number): boolean =>
  failures >= ATTEMPT_LIMIT;
