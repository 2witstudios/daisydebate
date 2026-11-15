import { and, eq } from 'drizzle-orm';
import type { ConflictConnection } from '@daisy/protocol/authorization';
import { actors } from '../schema/actors';
import { entries, entryMembers } from '../schema/entries';
import { fixtureEntries } from '../schema/fixtures';
import { roomParticipants } from '../schema/rooms';
import { memberships } from '../schema/organizations';
import { guardianLinks } from '../schema/guardian-links';
import { conflicts } from '../schema/conflicts';
import type { TabTransaction } from './tab-transaction';

/** Current connections on the addressed fixture, after account and aggregate fences. */
export const fixtureConnections = async (
  tx: TabTransaction,
  input: {
    readonly fixtureId: string;
    readonly roomId: string | null;
    readonly userId: string;
  },
): Promise<readonly ConflictConnection[]> => {
  const cast = input.roomId
    ? await tx
        .select({ userId: actors.userId })
        .from(roomParticipants)
        .innerJoin(actors, eq(actors.id, roomParticipants.actorId))
        .where(eq(roomParticipants.roomId, input.roomId))
    : await tx
        .select({ userId: actors.userId })
        .from(entryMembers)
        .innerJoin(
          fixtureEntries,
          eq(fixtureEntries.entryId, entryMembers.entryId),
        )
        .innerJoin(actors, eq(actors.id, entryMembers.actorId))
        .where(eq(fixtureEntries.fixtureId, input.fixtureId));
  const schools = await tx
    .select({ id: entries.schoolOrganizationId })
    .from(fixtureEntries)
    .innerJoin(entries, eq(entries.id, fixtureEntries.entryId))
    .where(eq(fixtureEntries.fixtureId, input.fixtureId));
  const own = await tx
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, input.userId),
        eq(memberships.status, 'active'),
      ),
    );
  const wards = await tx
    .select({ userId: guardianLinks.minorUserId })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.guardianUserId, input.userId),
        eq(guardianLinks.status, 'active'),
      ),
    );
  const declared = await tx
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.fixtureId, input.fixtureId),
        eq(conflicts.userId, input.userId),
      ),
    );
  return [
    ...(cast.some((person) => person.userId === input.userId)
      ? ['seated' as const]
      : []),
    ...(schools.some((school) =>
      own.some((member) => member.organizationId === school.id),
    )
      ? ['school_entry' as const]
      : []),
    ...(cast.some((person) =>
      wards.some((ward) => ward.userId === person.userId),
    )
      ? ['ward' as const]
      : []),
    ...(declared.some((row) => row.basis === 'declared')
      ? ['declared' as const]
      : []),
  ];
};
