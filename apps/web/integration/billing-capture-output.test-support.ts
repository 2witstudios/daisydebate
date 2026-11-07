import { mkdir, mkdtemp } from 'node:fs/promises';

/** Explicit proof paths retain their artifacts; ordinary runners get an owned root. */
export async function makeCaptureRoot(directory: string | undefined) {
  if (directory === undefined) return mkdtemp('/tmp/billing-capture-');
  if (
    !directory.startsWith('/tmp/billing-capture-') ||
    directory.includes('..')
  )
    throw Error('Named private capture output required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}
