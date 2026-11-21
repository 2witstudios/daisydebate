import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { videoAudienceCaps } from '@daisy/protocol/lobby';
import {
  guardianLinks,
  restrictions,
  restrictionLobbies,
} from '../schema/guardian-links';
import { bumpTabAccountRevision } from './command-accounts';
import type { Tx } from '../tx';
type VideoAudienceCap = (typeof videoAudienceCaps)[number];
type GuardianLinkStatus = (typeof guardianLinks.$inferSelect)['status'];
type GuardianLinkRow = Pick<
  typeof guardianLinks.$inferSelect,
  | 'id'
  | 'guardianUserId'
  | 'minorUserId'
  | 'kind'
  | 'viaOrganizationId'
  | 'status'
  | 'version'
>;
type LinkPeople = {
  readonly guardianLinkId: string;
  readonly guardianUserId: string;
  readonly minorUserId: string;
};

export type GuardianCommandWrite =
  | {
      readonly table: 'guardian_links';
      readonly op: 'insert';
      readonly row: Omit<GuardianLinkRow, 'version' | 'status'> & {
        readonly status: 'pending';
      };
    }
  | {
      readonly table: 'guardian_links';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly status?: GuardianLinkStatus;
        readonly endedAt?: string;
        readonly version: number;
      };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'insert';
      readonly row: LinkPeople & {
        readonly limitsLobbies: boolean;
        readonly videoAudienceCap: VideoAudienceCap;
      };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'update';
      readonly guardianLinkId: string;
      readonly set: {
        readonly limitsLobbies: boolean;
        readonly videoAudienceCap: VideoAudienceCap;
        readonly version: number;
      };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'delete';
      readonly guardianLinkId: string;
    }
  | {
      readonly table: 'restriction_lobbies';
      readonly op: 'insert';
      readonly row: LinkPeople & { readonly lobbyId: string };
    }
  | {
      readonly table: 'restriction_lobbies';
      readonly op: 'delete';
      readonly guardianLinkId: string;
      readonly lobbyId: string;
    }
  /** Moves the ward's account revision, so stale authority is dropped. */
  | {
      readonly table: 'users';
      readonly op: 'update';
      readonly id: string;
      readonly increment: 'version';
    };

const one = (rows: readonly unknown[]): void => {
  if (rows.length !== 1)
    throw createAppError(
      'INVARIANT',
      'Family write did not affect its fenced row',
    );
};
/** No privilege elevation: production family-table writes remain revoked. */
export const applyGuardianCommandWrites = async (
  tx: Tx,
  writes: readonly GuardianCommandWrite[],
): Promise<void> => {
  for (const write of writes) {
    switch (write.table) {
      case 'guardian_links':
        if (write.op === 'insert')
          await tx.insert(guardianLinks).values(write.row);
        else {
          const { endedAt, ...set } = write.set;
          one(
            await tx
              .update(guardianLinks)
              .set({
                ...set,
                ...(endedAt === undefined
                  ? {}
                  : { endedAt: new Date(endedAt) }),
              })
              .where(
                and(
                  eq(guardianLinks.id, write.id),
                  eq(guardianLinks.version, set.version - 1),
                ),
              )
              .returning({ id: guardianLinks.id }),
          );
        }
        break;
      case 'restrictions':
        if (write.op === 'insert')
          await tx.insert(restrictions).values(write.row);
        else if (write.op === 'delete')
          one(
            await tx
              .delete(restrictions)
              .where(eq(restrictions.guardianLinkId, write.guardianLinkId))
              .returning({ id: restrictions.guardianLinkId }),
          );
        else
          one(
            await tx
              .update(restrictions)
              .set(write.set)
              .where(
                and(
                  eq(restrictions.guardianLinkId, write.guardianLinkId),
                  eq(restrictions.version, write.set.version - 1),
                ),
              )
              .returning({ id: restrictions.guardianLinkId }),
          );
        break;
      case 'restriction_lobbies':
        if (write.op === 'insert')
          await tx.insert(restrictionLobbies).values(write.row);
        else
          one(
            await tx
              .delete(restrictionLobbies)
              .where(
                and(
                  eq(restrictionLobbies.guardianLinkId, write.guardianLinkId),
                  eq(restrictionLobbies.lobbyId, write.lobbyId),
                ),
              )
              .returning({ id: restrictionLobbies.lobbyId }),
          );
        break;
      case 'users':
        await bumpTabAccountRevision(tx, write.id);
        break;
    }
  }
};
