import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 hex for a process that runs with nothing installed: the
 * Incidents poster (`scripts/notify-drive.ts`), which a registry outage must
 * never stop (ISSUE-225), so it imports this file by path and loads no
 * package. The same bytes as `hmacSha256Hex`; `sha2.test.ts` holds them equal.
 */
export const standaloneHmacSha256Hex = (key: string, message: string) =>
  createHmac('sha256', key).update(message, 'utf8').digest('hex');
