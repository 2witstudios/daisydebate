import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

/** Node browser driver asks a Bun read-only process; no service URL is printed. */
export async function launchEvidence(roomId: string) {
  const { stdout } = await promisify(execFile)(
    'bun',
    [resolve(import.meta.dirname, 'room-launch-evidence-process.ts'), roomId],
    {
      cwd: resolve(import.meta.dirname, '../../../..'),
      env: process.env,
    },
  );
  return JSON.parse(stdout) as {
    hash: string;
    counts: {
      users: number;
      actors: number;
      rooms: number;
      rounds: number;
      seats: number;
      roundSeats: number;
      commands: number;
      outbox: number;
    };
    frozen: {
      status: string;
      topic: string;
      config: unknown;
      rules: unknown;
      cast: string[];
      startedAt: string | null;
    }[];
    launchDoorbells: number;
  };
}
