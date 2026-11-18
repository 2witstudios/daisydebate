import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Funds a Club plan for the manager through a Bun worker on the e2e database (ADR 0148). */
export function fundClub(input: {
  readonly managerEmail: string;
  readonly name: string;
  readonly seats: number;
}): Promise<{ readonly organizationId: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [fileURLToPath(new URL('./club-seats-worker.ts', import.meta.url))],
      { timeout: 30000, maxBuffer: 4096 },
      (error, stdout) => {
        if (error) return reject(new Error('Club funding refused'));
        try {
          resolve(JSON.parse(stdout) as { organizationId: string });
        } catch {
          reject(new Error('Club funding answered nothing'));
        }
      },
    );
    child.stdin?.end(JSON.stringify(input));
  });
}
