import { request } from 'node:http';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireLaunchSlot } from './room-launch-slot';
import type { LaunchControlOperation } from './room-launch-control';

export const launchControlPath = (id: string) =>
  join(tmpdir(), `drl-${id}.sock`);
export const launchAppControlPath = (id: string) =>
  join(tmpdir(), `dra-${id}.sock`);
/** Close owned browser contexts even when the auth control refuses settlement. */
export async function closeSettledLaunchContexts(
  accounts: { closeContexts(): Promise<void> },
  settle: () => Promise<void> = settledLaunchAuth,
) {
  try {
    await settle();
  } finally {
    await accounts.closeContexts();
  }
}

export async function callLaunchControl(
  path: string,
  operation: LaunchControlOperation,
) {
  await new Promise<void>((accept, reject) => {
    const call = request(
      { socketPath: path, path: `/${operation}`, method: 'POST' },
      (response) => {
        response.resume();
        response.once('end', () =>
          response.statusCode === 204
            ? accept()
            : reject(new Error('Launch control refused')),
        );
      },
    );
    call.setTimeout(60000, () =>
      call.destroy(new Error('Launch control deadline')),
    );
    call.once('error', reject);
    call.end();
  });
}
/** Test driver capability for only this dedicated fixture's owned ingress and processes. */
export const controlLaunch = (operation: LaunchControlOperation) => {
  const { id } = requireLaunchSlot(
    resolve(import.meta.dirname, '../../../..'),
    process.env,
  );
  return callLaunchControl(launchControlPath(id), operation);
};
/** Await the actual auth process's background work before recording/closing. */
export const settledLaunchAuth = () => controlLaunch('settled');
