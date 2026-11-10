import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { idSchema } from '@daisy/protocol';
import { economicsInstant } from '../features/billing/economics-input';
import type { createBillingEconomicsCollector } from '../features/billing/economics-collector';

type PrivateReport = Parameters<
  Parameters<typeof createBillingEconomicsCollector>[0]['save']
>[0];
const maximumFeedBytes = 1024 * 1024;
const retentionMs = 30 * 86400000;
/** The sink admits at most1000 files; a bounded sweep can therefore visit every file it creates. */
async function prunePrivateFiles(directory: string, now: string) {
  if (!economicsInstant.safeParse(now).success)
    throw new Error('Billing economics clock invalid');
  const stream = await opendir(directory);
  let count = 0,
    visited = 0;
  for await (const entry of stream) {
    if (++visited > 1000)
      throw new Error('Billing economics directory capacity exceeded');
    count++;
    if (
      !/^(report-[a-z][a-z0-9]{23}|feed-\d{4}-\d{2})\.json$/.test(entry.name) ||
      !entry.isFile()
    )
      continue;
    const path = join(directory, entry.name),
      info = await lstat(path);
    if (info.isFile() && info.mtimeMs <= Date.parse(now) - retentionMs) {
      await unlink(path);
      count--;
    }
  }
  return count;
}
async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new Error('Billing economics directory is not private');
}
async function readBoundedJson(file: FileHandle) {
  const bytes = Buffer.alloc(maximumFeedBytes + 1);
  let length = 0;
  while (length < bytes.length) {
    const read = await file.read(bytes, length, bytes.length - length, length);
    if (read.bytesRead === 0) break;
    length += read.bytesRead;
  }
  if (length > maximumFeedBytes)
    throw new Error('Billing economics feed exceeds size limit');
  try {
    return JSON.parse(bytes.subarray(0, length).toString('utf8')) as unknown;
  } catch {
    throw new Error('Billing economics feed is invalid');
  }
}
async function readPrivateFeed(path: string) {
  let file;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return null;
    throw new Error('Billing economics feed unavailable');
  }
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > maximumFeedBytes
    )
      throw new Error('Billing economics feed is not bounded and private');
    return await readBoundedJson(file);
  } finally {
    await file.close();
  }
}
/** Local service/operator-owned files only; no HTTP surface, credentials or production configuration are introduced. */
export function createBillingEconomicsFiles(input: {
  readonly directory: string;
  readonly nextId: () => string;
  readonly now: () => string;
}) {
  return {
    /** The sink itself: a private directory whose bounded retention sweep completes. */
    sink: {
      async open() {
        await privateDirectory(input.directory);
        await prunePrivateFiles(input.directory, input.now());
      },
    },
    feed: {
      async read(window: {
        readonly startsAt: string;
        readonly endsAt: string;
      }) {
        if (
          !economicsInstant.safeParse(window.startsAt).success ||
          !economicsInstant.safeParse(window.endsAt).success
        )
          throw new Error('Billing economics window invalid');
        return readPrivateFeed(
          join(input.directory, `feed-${window.startsAt.slice(0, 7)}.json`),
        );
      },
    },
    async save(report: PrivateReport) {
      await privateDirectory(input.directory);
      if ((await prunePrivateFiles(input.directory, input.now())) >= 1000)
        throw new Error('Billing economics directory capacity exceeded');
      const id = input.nextId();
      if (!idSchema.safeParse(id).success)
        throw new Error('Billing economics report identity invalid');
      const file = await open(
        join(input.directory, `report-${id}.json`),
        'wx',
        0o600,
      );
      try {
        await file.writeFile(JSON.stringify(report));
        await file.sync();
      } finally {
        await file.close();
      }
    },
  };
}
