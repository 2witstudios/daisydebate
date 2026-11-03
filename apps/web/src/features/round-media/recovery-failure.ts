import { capacityRefusalFields } from '@daisy/db/capacity';
import { databaseFailure } from '@daisy/db/database-failure';

/**
 * What stopped recovery work, as loggable fields with no raw error: a lane's
 * refusal with its pressure, what the database said, or `internal`.
 */
export const recoveryFailureFields = (error: unknown) =>
  capacityRefusalFields(error) ?? {
    cause: databaseFailure(error) ?? 'internal',
  };
