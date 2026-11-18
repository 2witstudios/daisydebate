import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_QUEUE_BATCH,
} from './retry-policy';

type Claimed = { readonly id: string; readonly token: string };

/**
 * One batch of a durable mail queue (ADR 0075): claim up to `limit` due
 * jobs under the shared lease policy, decide each one after another, and
 * settle it. A job whose decision throws is answered by `undecided` (a
 * counted, failed attempt) and never aborts the rest of the batch
 * (ISSUE-656). Resolves to how many jobs it settled; a job whose lease
 * lapsed meanwhile does not count.
 */
export async function runMailQueue<Claim extends Claimed, Outcome>(input: {
  readonly limit: number;
  readonly nextToken: () => string;
  readonly claim: (batch: {
    readonly limit: number;
    readonly leaseMs: number;
    readonly maxAttempts: number;
    readonly nextToken: () => string;
  }) => Promise<readonly Claim[]>;
  readonly decide: (claim: Claim) => Promise<Outcome>;
  readonly undecided: (claim: Claim, error: unknown) => Outcome;
  readonly settle: (settle: {
    readonly id: string;
    readonly token: string;
    readonly outcome: Outcome;
  }) => Promise<boolean>;
}): Promise<number> {
  const claims = await input.claim({
    limit: Math.min(input.limit, MAIL_QUEUE_BATCH),
    leaseMs: MAIL_LEASE_MS,
    maxAttempts: MAIL_MAX_ATTEMPTS,
    nextToken: input.nextToken,
  });
  let settled = 0;
  for (const claim of claims) {
    const outcome = await input
      .decide(claim)
      .catch((error: unknown) => input.undecided(claim, error));
    if (await input.settle({ id: claim.id, token: claim.token, outcome }))
      settled += 1;
  }
  return settled;
}
