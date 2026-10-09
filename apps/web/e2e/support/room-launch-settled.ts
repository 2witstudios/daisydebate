import { request } from 'node:http';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireLaunchSlot } from './room-launch-slot';

export const launchControlPath = (id: string) =>
  join(tmpdir(), `daisy-room-launch-${id}.sock`);
/** Await the actual auth process's background work before recording/closing. */
export async function settledLaunchAuth() {
  const { id } = requireLaunchSlot(
    resolve(import.meta.dirname, '../../../..'),
    process.env,
  );
  await new Promise<void>((accept, reject) => {
    const call = request(
      { socketPath: launchControlPath(id), path: '/settled', method: 'POST' },
      (response) => {
        response.resume();
        response.once('end', () =>
          response.statusCode === 204
            ? accept()
            : reject(new Error('Launch auth did not settle')),
        );
      },
    );
    call.setTimeout(10_000, () =>
      call.destroy(new Error('Launch auth settling deadline')),
    );
    call.once('error', reject);
    call.end();
  });
}
