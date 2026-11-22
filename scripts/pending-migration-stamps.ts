import { addMs, tryInstantMs } from '@daisy/clock';
import type { SnapshotLink } from './check-migrations';

const originId = '00000000-0000-0000-0000-000000000000';
const instant = (stamp: string) =>
  `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
const validTag = (tag: string) =>
  /^\d{14}_[a-z0-9_]+$/.test(tag) &&
  tryInstantMs(instant(tag.slice(0, 14))) !== undefined;

/** Names change only after the declared snapshot chain is unambiguous. */
export function pendingMigrationPlan(
  base: readonly SnapshotLink[],
  pending: readonly SnapshotLink[],
) {
  const problems: string[] = [];
  const renames: { from: string; to: string }[] = [];
  const all = [...base, ...pending];
  if (
    all.some((migration) => !validTag(migration.tag) || !migration.id) ||
    new Set(all.map((migration) => migration.id)).size !== all.length
  )
    return {
      renames,
      problems: [
        'Migration names and snapshot identities must be valid and unique',
      ],
    };
  const remaining = new Set(pending);
  const ordered: SnapshotLink[] = [];
  let predecessor = base.at(-1)?.id ?? originId;
  while (remaining.size) {
    const next = [...remaining].filter((migration) =>
      migration.prevIds.includes(predecessor),
    );
    if (next.length !== 1)
      return {
        renames: [],
        problems: [
          'Pending snapshots diverge from the destination; reconcile with drizzle-kit before preparing',
        ],
      };
    const migration = next[0]!;
    ordered.push(migration);
    remaining.delete(migration);
    predecessor = migration.id;
  }
  let previousStamp = base.at(-1)?.tag.slice(0, 14);
  for (const migration of ordered) {
    let stamp = migration.tag.slice(0, 14);
    if (previousStamp && stamp <= previousStamp) {
      stamp = addMs(instant(previousStamp), 1000)
        .replace(/\D/g, '')
        .slice(0, 14);
      if (stamp.length !== 14 || stamp <= previousStamp)
        return {
          renames: [],
          problems: ['Migration timestamp range is exhausted'],
        };
    }
    const to = `${stamp}${migration.tag.slice(14)}`;
    if (to !== migration.tag) renames.push({ from: migration.tag, to });
    previousStamp = stamp;
  }
  return { renames, problems };
}
