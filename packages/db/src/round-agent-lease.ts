import { createAppError } from '@daisy/errors';

export function agentLeaseDigest(token: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw createAppError('AUTHORIZATION');
  return new Bun.CryptoHasher('sha3-256').update(token).digest('hex');
}
/** Both sides are SHA3-256 digests, so a plain comparison leaks no secret timing. */
export function requireAgentLeaseToken(token: string, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest) || agentLeaseDigest(token) !== digest)
    throw createAppError('AUTHORIZATION');
}
