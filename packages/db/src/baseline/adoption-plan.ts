import { z } from 'zod';
import supersededJournalJson from './superseded-journal.json';

/** One row of drizzle's journal, `drizzle.__drizzle_migrations`. */
export type JournalRow = {
  readonly id: number;
  readonly hash: string;
  readonly createdAt: number;
  readonly name: string | null;
};

/** One folder as the migrator reads it: name, SQL hash and timestamp. */
export type JournalStamp = {
  readonly name: string;
  readonly hash: string;
  readonly createdAt: number;
};

/**
 * The journal rows of the folders the baseline replaced, in apply order,
 * as `generate-baseline.ts` read them from the old history (ADR 0913).
 */
export const supersededJournal: readonly JournalStamp[] = z
  .array(
    z.object({
      name: z.string(),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      createdAt: z.number().int(),
    }),
  )
  .min(1)
  .parse(supersededJournalJson);

export type AdoptionRefusal =
  | { readonly kind: 'already-adopted' }
  | {
      readonly kind: 'history-differs';
      readonly position: number;
      readonly expected: string | null;
      readonly found: string | null;
    }
  | {
      readonly kind: 'unknown-folder';
      readonly position: number;
      readonly found: string | null;
    };

/**
 * What a swap does to a journal: delete the superseded rows, and record the
 * baseline in the first of their ids so it stays first; the rows of later
 * folders stay as they are. `later` names those folders, which the reference
 * database applies on top of the baseline.
 */
export type AdoptionPlan = {
  readonly deleteIds: readonly number[];
  readonly baselineId: number;
  readonly later: readonly JournalStamp[];
};

const sameStamp = (row: JournalRow | undefined, stamp: JournalStamp) =>
  row !== undefined &&
  row.name === stamp.name &&
  row.hash === stamp.hash &&
  row.createdAt === stamp.createdAt;

/**
 * Plans the journal swap, or refuses it. The journal (in id order) must be
 * exactly the superseded history followed by a prefix of the image's
 * folders after the baseline; anything else is a database this command
 * does not know, and it changes nothing.
 */
export function planAdoption({
  journal,
  superseded,
  baseline,
  imageLater,
}: {
  readonly journal: readonly JournalRow[];
  readonly superseded: readonly JournalStamp[];
  readonly baseline: JournalStamp;
  /** The image's folders after the baseline, in apply order. */
  readonly imageLater: readonly JournalStamp[];
}):
  | { readonly ok: true; readonly plan: AdoptionPlan }
  | {
      readonly ok: false;
      readonly refusal: AdoptionRefusal;
    } {
  if (journal.some(({ name }) => name === baseline.name))
    return { ok: false, refusal: { kind: 'already-adopted' } };
  const differs = superseded.findIndex(
    (stamp, index) => !sameStamp(journal[index], stamp),
  );
  if (differs !== -1)
    return {
      ok: false,
      refusal: {
        kind: 'history-differs',
        position: differs,
        expected: superseded[differs]?.name ?? null,
        found: journal[differs]?.name ?? null,
      },
    };
  const rest = journal.slice(superseded.length);
  const unknown = rest.findIndex(
    (row, index) =>
      imageLater[index] === undefined || !sameStamp(row, imageLater[index]),
  );
  if (unknown !== -1)
    return {
      ok: false,
      refusal: {
        kind: 'unknown-folder',
        position: superseded.length + unknown,
        found: rest[unknown]?.name ?? null,
      },
    };
  const deleteIds = journal.slice(0, superseded.length).map(({ id }) => id);
  return {
    ok: true,
    plan: {
      deleteIds,
      baselineId: Math.min(...deleteIds),
      later: imageLater.slice(0, rest.length),
    },
  };
}

/**
 * Whether the journal read under the lock plans a different swap from the
 * one the reference was built for: another row to delete, or another set of
 * later folders. The reference then no longer describes the live database.
 */
export const journalMoved = (built: AdoptionPlan, locked: AdoptionPlan) =>
  built.deleteIds.join() !== locked.deleteIds.join() ||
  built.later.map(({ name }) => name).join() !==
    locked.later.map(({ name }) => name).join();

export const describeRefusal = (refusal: AdoptionRefusal): string => {
  switch (refusal.kind) {
    case 'already-adopted':
      return 'The journal already records the baseline; nothing to adopt';
    case 'history-differs':
      return `Journal row ${refusal.position} is ${refusal.found ?? 'missing'}, where the superseded history has ${refusal.expected ?? 'nothing'}; this database is not at the cut-off`;
    case 'unknown-folder':
      return `Journal row ${refusal.position} records ${refusal.found ?? 'nothing'}, which is not the image's next folder after the baseline`;
  }
};
