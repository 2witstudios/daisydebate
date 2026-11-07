import { mkdir, mkdtemp, rm } from 'node:fs/promises';

/** Explicit proof paths retain their artifacts; ordinary runners get an owned root. */
export async function makeCaptureRoot(directory: string | undefined) {
  if (
    directory !== undefined &&
    (!directory.startsWith('/tmp/billing-capture-') || directory.includes('..'))
  )
    throw Error('Named private capture output required');
  const path = directory ?? (await mkdtemp('/tmp/billing-capture-'));
  if (directory !== undefined)
    await mkdir(path, { recursive: true, mode: 0o700 });
  return {
    path,
    close: async () => {
      if (directory === undefined)
        await rm(path, { recursive: true, force: true });
    },
  };
}
