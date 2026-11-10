import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createRefusal } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  economicsInstant,
  isEconomicsWindow,
} from '../features/billing/economics-input';
import { previousEconomicsMonth } from '../features/billing/economics-policy';
import type { createBillingEconomicsCollector } from '../features/billing/economics-collector';

type PrivateReport = Parameters<
  Parameters<typeof createBillingEconomicsCollector>[0]['save']
>[0];
type Window = { readonly startsAt: string; readonly endsAt: string };
const maximumFeedBytes = 1024 * 1024;
const retentionMs = 30 * 86400000;
const sinkFull = () =>
  createRefusal(
    'INFRASTRUCTURE',
    'economics-sink-full',
    'Billing economics directory capacity exceeded',
  );
const notPrivate = () =>
  createRefusal(
    'VALIDATION',
    'economics-feed-not-private',
    'Billing economics feed is not a private regular file',
  );
const tooLarge = () =>
  createRefusal(
    'VALIDATION',
    'economics-feed-too-large',
    'Billing economics feed exceeds size limit',
  );
/**
 * The sink admits at most 1000 files, so a bounded sweep can visit every file
 * it creates. A feed is kept while its collection window is open (DEC-372): the
 * month this run collects, the month the worker collects and the current
 * month; an earlier month's feed is removed. Any other file goes after 30 days.
 */
async function prunePrivateFiles(
  directory: string,
  now: string,
  collecting: string,
) {
  if (!economicsInstant.safeParse(now).success)
    throw createRefusal(
      'INTERNAL',
      'economics-clock-invalid',
      'Billing economics clock invalid',
    );
  const workerMonth = previousEconomicsMonth(now)?.startsAt.slice(0, 7) ?? '';
  const kept = new Set([collecting, workerMonth, now.slice(0, 7)]);
  const stream = await opendir(directory);
  let count = 0,
    visited = 0;
  for await (const entry of stream) {
    if (++visited > 1000) throw sinkFull();
    count++;
    if (
      !/^(report-[a-z][a-z0-9]{23}|feed-\d{4}-\d{2})\.json$/.test(entry.name) ||
      !entry.isFile()
    )
      continue;
    const feedMonth = /^feed-(\d{4}-\d{2})\.json$/.exec(entry.name)?.[1];
    if (feedMonth !== undefined && kept.has(feedMonth)) continue;
    const path = join(directory, entry.name),
      info = await lstat(path);
    if (
      info.isFile() &&
      ((feedMonth !== undefined && feedMonth < workerMonth) ||
        info.mtimeMs <= Date.parse(now) - retentionMs)
    ) {
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
    throw createRefusal(
      'VALIDATION',
      'economics-sink-not-private',
      'Billing economics directory is not private',
    );
}
async function readBoundedJson(file: FileHandle) {
  const bytes = Buffer.alloc(maximumFeedBytes + 1);
  let length = 0;
  while (length < bytes.length) {
    const read = await file.read(bytes, length, bytes.length - length, length);
    if (read.bytesRead === 0) break;
    length += read.bytesRead;
  }
  if (length > maximumFeedBytes) throw tooLarge();
  return JSON.parse(bytes.subarray(0, length).toString('utf8')) as unknown;
}
async function readPrivateFeed(path: string) {
  let file;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as { readonly code?: unknown } | null)?.code;
    if (code === 'ENOENT') return null;
    // A symbolic link in the feed's place.
    if (code === 'ELOOP') throw notPrivate();
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw notPrivate();
    if (stat.size > maximumFeedBytes) throw tooLarge();
    return await readBoundedJson(file);
  } finally {
    await file.close();
  }
}
function assertWindow(window: Window) {
  if (!isEconomicsWindow(window))
    throw createRefusal(
      'INTERNAL',
      'economics-window-invalid',
      'Billing economics window invalid',
    );
}
/** Local service/operator-owned files only; no HTTP surface, credentials or production configuration are introduced. */
export function createBillingEconomicsFiles(input: {
  readonly directory: string;
  readonly nextId: () => string;
  readonly now: () => string;
}) {
  return {
    feed: {
      async read(window: Window) {
        assertWindow(window);
        const month = window.startsAt.slice(0, 7);
        await privateDirectory(input.directory);
        await prunePrivateFiles(input.directory, input.now(), month);
        return readPrivateFeed(join(input.directory, `feed-${month}.json`));
      },
    },
    async save(report: PrivateReport) {
      await privateDirectory(input.directory);
      const month = report.report.startsAt.slice(0, 7);
      if (
        (await prunePrivateFiles(input.directory, input.now(), month)) >= 1000
      )
        throw sinkFull();
      const id = input.nextId();
      if (!idSchema.safeParse(id).success)
        throw createRefusal(
          'INTERNAL',
          'economics-report-identity-invalid',
          'Billing economics report identity invalid',
        );
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
