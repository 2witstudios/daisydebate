import { randomBytes } from 'node:crypto';

/**
 * A fresh 256-bit OS-CSPRNG bearer capability for one scoped round worker
 * lease. Only its digest is stored; it is never logged.
 */
export const nextWorkerToken = () => randomBytes(32).toString('base64url');
