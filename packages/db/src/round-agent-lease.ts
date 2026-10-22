import { timingSafeEqual } from 'node:crypto';
import { createAppError } from '@daisy/errors';

export function agentLeaseDigest(token: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw createAppError('AUTHORIZATION');
  return new Bun.CryptoHasher('sha3-256').update(token).digest('hex');
}
export function requireAgentLeaseToken(token: string, digest: string) {
  const actual = agentLeaseDigest(token);
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(digest))
  )
    throw createAppError('AUTHORIZATION');
}
