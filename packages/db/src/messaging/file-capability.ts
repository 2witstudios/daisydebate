import { createAppError } from '@daisy/errors';
import type { FileFrame } from '../messaging-files';
const deny = async (): Promise<never> => {
  throw createAppError('AUTHORIZATION');
};
/** Method selection cannot widen the canonical capability chosen for this tx. */
export function scopeFileFrame(
  frame: FileFrame,
  capability: 'post' | 'read',
): FileFrame {
  if (capability === 'post') return { ...frame, access: deny };
  return {
    access: frame.access,
    authorize: deny,
    reserve: deny,
    upload: deny,
    scan: deny,
    quarantine: deny,
    renew: deny,
    finalize: deny,
    cancel: deny,
  };
}
