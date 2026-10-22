import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

/** Node driver invokes only these admitted, read-only Bun observation processes. */
export async function executeLaunchEvidence(
  entry: 'room-launch-evidence-process.ts' | 'attendance-evidence-process.ts',
  scopeId: string,
) {
  try {
    const { stdout } = await promisify(execFile)(
      'bun',
      [resolve(import.meta.dirname, entry), scopeId],
      {
        cwd: resolve(import.meta.dirname, '../../../..'),
        env: process.env,
        maxBuffer: 262144,
      },
    );
    return stdout;
  } catch {
    throw new Error('Launch evidence worker refused');
  }
}
