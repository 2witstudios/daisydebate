import { lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { createAppError } from '@daisy/errors';

/** Qualification stores belong in an owner-only directory, outside payload backups. */
export function requirePrivateEvidenceDirectory(path: string) {
  const directory = lstatSync(dirname(path));
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0)
    throw createAppError('INFRASTRUCTURE');
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw createAppError('INFRASTRUCTURE');
}
