import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { decodeLaunchEvidence } from './room-launch-evidence-decoder';

/** Node browser driver asks a Bun read-only process; no service URL is printed. */
export async function launchEvidence(roomId: string) {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(
      'bun',
      [resolve(import.meta.dirname, 'room-launch-evidence-process.ts'), roomId],
      {
        cwd: resolve(import.meta.dirname, '../../../..'),
        env: process.env,
        maxBuffer: 262_144,
      },
    ));
  } catch {
    throw new Error('Launch evidence worker refused');
  }
  return decodeLaunchEvidence(stdout);
}
