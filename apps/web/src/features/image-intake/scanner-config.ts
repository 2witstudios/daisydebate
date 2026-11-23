import type { Waits } from '@daisy/clock';
import type { FileScanner } from './ports';
import { createClamdScanner } from './clamd';

/**
 * The deployment's malware scanner from `CLAMD_HOST` and `CLAMD_PORT`, or
 * null when either is missing: an intake without a scanner refuses.
 */
export const configuredScanner = (
  env: Readonly<Record<string, string | undefined>>,
  waits: Waits,
): FileScanner | null => {
  const host = env['CLAMD_HOST'];
  const port = Number(env['CLAMD_PORT']);
  return host && Number.isInteger(port) && port > 0 && port < 65_536
    ? createClamdScanner({ host, port }, waits)
    : null;
};
