import { createAppError } from '@daisy/errors';
import { requireLeaseMs } from './lease-policy';
import type { CaptureDependencies } from './media-capture-context';

export const evidenceLeaseDigest = (token: string) => {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
    throw createAppError('AUTHORIZATION');
  return new Bun.CryptoHasher('sha3-256').update(token).digest('hex');
};
export const evidencePolicyOf = (dependencies: CaptureDependencies) => {
  const policy = dependencies.evidence;
  if (!policy)
    throw createAppError(
      'INFRASTRUCTURE',
      'Necessary evidence is not configured',
    );
  requireLeaseMs(policy.leaseMs);
  if (
    !Number.isSafeInteger(policy.maxRoundBytes) ||
    policy.maxRoundBytes < 1 ||
    policy.maxRoundBytes > 32 * 1024 * 1024 ||
    !Number.isSafeInteger(policy.maxGlobalBytes) ||
    policy.maxGlobalBytes < policy.maxRoundBytes ||
    policy.maxGlobalBytes > 512 * 1024 * 1024 ||
    !Number.isSafeInteger(policy.maxOutstandingIntents) ||
    policy.maxOutstandingIntents < 1 ||
    policy.maxOutstandingIntents > 65536
  )
    throw createAppError('VALIDATION');
  return policy;
};
