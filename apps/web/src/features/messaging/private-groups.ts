import { createAppError } from '@daisy/errors';
import type { MessagingRuntimePolicy } from './composition';

/**
 * ISSUE-643 (DEC-127): every private-group creation, invitation and
 * admission refuses while groups are off, whatever group policy is
 * supplied. Reading, leaving and removal keep their own authority.
 */
export function requirePrivateGroups(
  policy: Pick<MessagingRuntimePolicy, 'privateGroups'>,
) {
  if (policy.privateGroups !== 'isolated-test-fixture')
    throw createAppError('AUTHORIZATION');
}
