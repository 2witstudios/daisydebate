/** A rate limiter's `consume`, as account handler tests stub it. */
export type ConsumeStub = () => Promise<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

/** A limiter that lets every request through. */
export const allowEvery: ConsumeStub = async () => ({
  allowed: true,
  retryAfterSeconds: 0,
});
