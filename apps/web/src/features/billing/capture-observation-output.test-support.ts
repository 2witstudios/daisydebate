import { mkdir, mkdtemp, rm } from 'node:fs/promises';

/** Ordinary suites own temporary output; explicit bounded proof output is retained as evidence. */
export async function captureObservationOutput(directory?: string) {
  if (directory === undefined) {
    const owned = await mkdtemp('/tmp/billing-capture-');
    return {
      directory: owned,
      close: () => rm(owned, { recursive: true, force: true }),
    };
  }
  if (
    !directory.startsWith('/tmp/billing-capture-') ||
    directory.includes('..')
  )
    throw Error('Named private capture output required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return { directory, close: async () => {} };
}
