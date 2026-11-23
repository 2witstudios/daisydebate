import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Opens bot debates (`bot-debates`, ADR 0921) for these accounts through a
 * Bun worker on the e2e database: the browser suite's stand-in for an
 * operator granting the account override. Without it a bot debate is
 * Coming soon, as it is for every ordinary member.
 */
export function releaseBotDebates(...emails: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [fileURLToPath(new URL('./bot-debates-worker.ts', import.meta.url))],
      { timeout: 30000, maxBuffer: 4096 },
      (error) =>
        error ? reject(new Error('Bot debates override refused')) : resolve(),
    );
    child.stdin?.end(JSON.stringify({ emails }));
  });
}
