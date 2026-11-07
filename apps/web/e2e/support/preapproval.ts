import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Real operator database operation, restricted to this suite's e2e login. */
export const preapproveEmail = (email: string, invite = false): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'bun',
      [fileURLToPath(new URL('./preapproval-worker.ts', import.meta.url))],
      { timeout: 20000, maxBuffer: 4096 },
      (error) =>
        error ? reject(new Error('Preapproval fixture refused')) : resolve(),
    );
    child.stdin?.end(JSON.stringify({ email, invite }));
  });
