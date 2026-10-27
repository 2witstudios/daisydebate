import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Approves accounts for the beta (ADR 0075) through a Bun worker on the e2e
 * database: the browser suite's stand-in for the operator's approval.
 */
export function approveBetaAccounts(...emails: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [fileURLToPath(new URL('./beta-access-worker.ts', import.meta.url))],
      { timeout: 20000, maxBuffer: 4096 },
      (error) =>
        error ? reject(new Error('Beta access approval refused')) : resolve(),
    );
    child.stdin?.end(JSON.stringify({ emails }));
  });
}
