import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createRefusal } from '@daisy/errors';
import {
  clockInvalid,
  sinkFull,
  windowInvalid,
} from '../features/billing/economics-refusals';
import { idSchema } from '@daisy/protocol';
import {
  economicsInstant,
  isEconomicsWindow,
} from '../features/billing/economics-input';
import type { createBillingEconomicsCollector } from '../features/billing/economics-collector';

type PrivateReport = Parameters<
  Parameters<typeof createBillingEconomicsCollector>[0]['save']
>[0];
const maximumFeedBytes = 1024 * 1024;
const retentionMs = 30 * 86400000;
/**
 * The sink admits at most 1000 files, so a bounded sweep can visit every file
 * it creates. `protectFrom` is the month being collected: its feed is never
 * expired under it.
 */
async function prunePrivateFiles(
  directory: string,
  now: string,
  protectFrom: string,
) {
  if (!economicsInstant.safeParse(now).success) throw clockInvalid();
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
    // Only the feed of the month being collected is protected, so no feed outlives the end of the
    // month after its own (compliance.md records that bound).
    if (feedMonth === protectFrom) continue;
    const path = join(directory, entry.name),
      info = await lstat(path);
    if (info.isFile() && info.mtimeMs <= Date.parse(now) - retentionMs) {
      await unlink(path);
      count--;
    }
  }
  return count;
}
/** Whether this process may read, write and enter the directory; the process edge passes node's `access`. */
type AccessDirectory = (path: string) => Promise<void>;

async function privateDirectory(
  directory: string,
  accessDirectory: AccessDirectory,
) {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    // The operator's setup refused it (a root-owned volume root, a file in the path, a read-only
    // mount): a typed refusal keeping the errno. Any other errno is the disk's and stays untyped.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (
      code !== 'EACCES' &&
      code !== 'EPERM' &&
      code !== 'ENOTDIR' &&
      code !== 'EEXIST' &&
      code !== 'EROFS'
    )
      throw error;
    throw createRefusal(
      'VALIDATION',
      'economics-sink-uncreatable',
      'Billing economics directory cannot be created by this process',
      error,
    );
  }
  const info = await lstat(directory);
  // Private: no group/other bits.
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw createRefusal(
      'VALIDATION',
      'economics-sink-not-private',
      'Billing economics directory is not private',
    );
  // Usable by this process (read, write, enter), asked of the kernel rather than inferred from
  // mode and uid, so root on a foreign-owned volume is not refused; a later refusal on a
  // file inside is then the file's, never the directory's.
  try {
    await accessDirectory(directory);
  } catch (error) {
    // Only a permission refusal is the setup's; any other errno (EIO, a stale mount) is the disk's.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS') throw error;
    throw createRefusal(
      'VALIDATION',
      'economics-sink-unusable',
      'Billing economics directory is not usable by this process',
      error,
    );
  }
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
    throw createRefusal(
      'VALIDATION',
      'economics-feed-too-large',
      'Billing economics feed exceeds size limit',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } catch (error) {
    throw createRefusal(
      'VALIDATION',
      'economics-feed-unparseable',
      'Billing economics feed is invalid',
      error,
    );
  }
  // `null` means an absent file to every caller, so a file whose body is null is invalid, never missing.
  if (parsed === null)
    throw createRefusal(
      'VALIDATION',
      'economics-feed-null',
      'Billing economics feed body is null',
    );
  return parsed;
}
/** How the feed file is opened; the process edge passes node's `open`. */
type OpenFeed = (path: string, flags: number) => Promise<FileHandle>;

async function readPrivateFeed(path: string, openFeed: OpenFeed) {
  let file;
  try {
    file = await openFeed(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code === 'ENOENT') return null;
    // A symbolic link, or a socket or device that cannot be opened, in the feed's place is the
    // operator's file being wrong.
    if (code === 'ELOOP' || code === 'ENXIO')
      throw createRefusal(
        'VALIDATION',
        'economics-feed-not-private',
        'Billing economics feed is not bounded and private',
        error,
      );
    // Permission refused: most often a feed placed as another user, but a mount or policy can
    // refuse too, so it has its own word and the errno stays its cause.
    if (code === 'EACCES' || code === 'EPERM')
      throw createRefusal(
        'VALIDATION',
        'economics-feed-forbidden',
        'Billing economics feed is not readable by this process',
        error,
      );
    throw createRefusal(
      'INFRASTRUCTURE',
      'economics-feed-unavailable',
      'Billing economics feed unavailable',
      error,
    );
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0)
      throw createRefusal(
        'VALIDATION',
        'economics-feed-not-private',
        'Billing economics feed is not bounded and private',
      );
    if (stat.size > maximumFeedBytes)
      throw createRefusal(
        'VALIDATION',
        'economics-feed-too-large',
        'Billing economics feed exceeds size limit',
      );
    return await readBoundedJson(file);
  } finally {
    await file.close();
  }
}
/** A collected window must be two instants; anything else is a caller defect. */
function assertWindow(window: {
  readonly startsAt: string;
  readonly endsAt: string;
}) {
  if (!isEconomicsWindow(window)) throw windowInvalid();
}
/** Local service/operator-owned files only; no HTTP surface, credentials or production configuration are introduced. */
export function createBillingEconomicsFiles(input: {
  readonly directory: string;
  readonly nextId: () => string;
  readonly now: () => string;
  /** The feed file opener; node's `open` unless a test must produce a specific refusal. */
  readonly openFeed?: OpenFeed;
  /** The directory usability check; node's `access` unless a test must produce a refusal. */
  readonly accessDirectory?: AccessDirectory;
}) {
  const accessDirectory: AccessDirectory =
    input.accessDirectory ??
    ((path) => access(path, constants.R_OK | constants.W_OK | constants.X_OK));
  return {
    /**
     * The sink itself: its directory exists and is private, and its bounded
     * retention sweep runs every tick, whether or not the collection reaches
     * `save` (which sweeps again as the capacity authority).
     */
    sink: {
      async open(window: {
        readonly startsAt: string;
        readonly endsAt: string;
      }) {
        // The window decides what retention protects, so a malformed one never reaches the sweep.
        assertWindow(window);
        await privateDirectory(input.directory, accessDirectory);
        // A full sink is refused here, before any database read, as the same refusal save makes.
        if (
          (await prunePrivateFiles(
            input.directory,
            input.now(),
            window.startsAt.slice(0, 7),
          )) >= 1000
        )
          throw sinkFull();
      },
    },
    feed: {
      async read(window: {
        readonly startsAt: string;
        readonly endsAt: string;
      }) {
        assertWindow(window);
        // The reader keeps its own privacy check, so a caller need not open the sink first. A
        // directory fault here is the sink's, never the feed file's, so it reads as unavailable.
        try {
          await privateDirectory(input.directory, accessDirectory);
        } catch (error) {
          throw createRefusal(
            'INFRASTRUCTURE',
            'economics-sink-unreadable',
            'Billing economics sink unavailable to the feed reader',
            error,
          );
        }
        return readPrivateFeed(
          join(input.directory, `feed-${window.startsAt.slice(0, 7)}.json`),
          input.openFeed ?? ((path, flags) => open(path, flags)),
        );
      },
    },
    async save(report: PrivateReport) {
      await privateDirectory(input.directory, accessDirectory);
      const protectFrom = report.report.startsAt.slice(0, 7);
      if (
        (await prunePrivateFiles(input.directory, input.now(), protectFrom)) >=
        1000
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
