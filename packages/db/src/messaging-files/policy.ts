import { createAppError } from '@daisy/errors';
import type { FilePolicy } from './records';
export function requireFilePolicy(policy: FilePolicy | undefined): FilePolicy {
  if (
    !policy ||
    Object.values(policy).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    policy.maxFileBytes > policy.maxStoredBytes
  )
    throw createAppError('INFRASTRUCTURE');
  const keys: readonly (keyof FilePolicy)[] = [
    'maxFileBytes',
    'maxStoredBytes',
    'maxStoredFiles',
    'maxFilesPerMessage',
    'reservationMs',
    'accessMs',
    'maxFilenameUnits',
    'maxImagePixels',
    'serviceMs',
  ];
  if (
    keys.some((key) => !Number.isSafeInteger(policy[key]) || policy[key] <= 0)
  )
    throw createAppError('INFRASTRUCTURE');
  return policy;
}
