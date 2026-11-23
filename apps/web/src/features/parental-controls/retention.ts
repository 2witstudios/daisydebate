import { type GuardiansStore } from '@daisy/db/stores/guardians';
import type { RetentionTarget } from '../../server/retention-target';

export const childAccountRequestRetentionTarget = (
  database: Pick<GuardiansStore, 'expireGuardianRequests'>,
): RetentionTarget => ({
  name: 'retention.child_account_requests',
  batchSize: 200,
  maxBatches: 20,
  purge: ({ limit }) => database.expireGuardianRequests(limit),
});
