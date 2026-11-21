import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { TournamentStatus } from '@daisy/protocol/lobby';
import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';
import { jsonObjectSchema } from '../schema/columns';
import { ladders } from '../schema/ladders';
import { lobbies, tournaments } from '../schema/lobbies';
import { seasons } from '../schema/seasons';
import { seasonStandingRules } from '../schema/sanctions';
import type { Tx } from '../tx';

type Insert<Table extends string, Row> = {
  readonly table: Table;
  readonly op: 'insert';
  readonly row: Row;
};
type Update<Table extends string, Row> = {
  readonly table: Table;
  readonly op: 'update';
  readonly id: string;
  readonly set: Partial<Row>;
};
type LobbyRow = {
  readonly ageRule: LobbyAgeRule | null;
  readonly name: string;
  readonly closedAt: string | null;
  readonly version: number;
};
type SeasonRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly lobbyId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly status: 'active' | 'closed';
  readonly version: number;
};
export type LobbyAdministrationWrite =
  | Insert<
      'lobbies',
      {
        readonly id: string;
        readonly kind: 'standing' | 'tournament';
        readonly ownerUserId: string | null;
        readonly ownerOrganizationId: string | null;
        readonly name: string;
        readonly handle: string;
        readonly ageRule?: LobbyAgeRule | null;
        readonly standingLobbyId?: string;
      }
    >
  | Update<'lobbies', LobbyRow>
  | Insert<
      'tournaments',
      {
        readonly lobbyId: string;
        readonly status: TournamentStatus;
      }
    >
  | Update<'tournaments', { readonly status: TournamentStatus }>
  | Insert<'seasons', Omit<SeasonRow, 'version'>>
  | Update<'seasons', SeasonRow>
  | Insert<
      'season_standing_rules',
      {
        readonly seasonId: string;
        readonly organizationId: string;
        readonly counting: 'sanction' | 'membership';
        readonly countsLobbyRooms: boolean;
        readonly rule: Readonly<Record<string, unknown>>;
      }
    >
  | Insert<
      'ladders',
      {
        readonly id: string;
        readonly lobbyId: string;
        readonly organizationId: string;
        readonly name: string;
      }
    >
  | Update<'ladders', { readonly name: string }>
  | { readonly table: 'ladders'; readonly op: 'delete'; readonly id: string };

const one = (rows: readonly unknown[]) => {
  if (rows.length !== 1)
    throw createAppError('INVARIANT', 'Tab write did not affect one row');
};
const at = (value: string | null) => (value === null ? null : new Date(value));

const apply = async (
  tx: Tx,
  write: LobbyAdministrationWrite,
): Promise<void> => {
  switch (write.table) {
    case 'lobbies':
      if (write.op === 'insert') {
        await tx.insert(lobbies).values(write.row);
        return;
      }
      return one(
        await tx
          .update(lobbies)
          .set({
            ...write.set,
            closedAt:
              write.set.closedAt === undefined
                ? undefined
                : at(write.set.closedAt),
          })
          .where(eq(lobbies.id, write.id))
          .returning({ id: lobbies.id }),
      );
    case 'tournaments':
      if (write.op === 'insert') {
        await tx.insert(tournaments).values(write.row);
        return;
      }
      return one(
        await tx
          .update(tournaments)
          .set(write.set)
          .where(eq(tournaments.lobbyId, write.id))
          .returning({ id: tournaments.lobbyId }),
      );
    case 'seasons':
      if (write.op === 'insert') {
        await tx.insert(seasons).values({
          ...write.row,
          startsAt: new Date(write.row.startsAt),
          endsAt: at(write.row.endsAt),
        });
        return;
      }
      return one(
        await tx
          .update(seasons)
          .set({
            name: write.set.name,
            status: write.set.status,
            version: write.set.version,
            endsAt:
              write.set.status === 'closed'
                ? sql`greatest(statement_timestamp(), ${seasons.startsAt} + interval '1 millisecond')`
                : write.set.endsAt === undefined
                  ? undefined
                  : at(write.set.endsAt),
          })
          .where(eq(seasons.id, write.id))
          .returning({ id: seasons.id }),
      );
    case 'season_standing_rules':
      await tx
        .insert(seasonStandingRules)
        .values({ ...write.row, rule: jsonObjectSchema.parse(write.row.rule) });
      return;
    case 'ladders':
      if (write.op === 'insert') {
        await tx.insert(ladders).values(write.row);
        return;
      }
      if (write.op === 'update')
        return one(
          await tx
            .update(ladders)
            .set(write.set)
            .where(eq(ladders.id, write.id))
            .returning({ id: ladders.id }),
        );
      return one(
        await tx
          .delete(ladders)
          .where(eq(ladders.id, write.id))
          .returning({ id: ladders.id }),
      );
  }
};
export const applyLobbyAdministrationWrites = async (
  tx: Tx,
  writes: readonly LobbyAdministrationWrite[],
): Promise<void> => {
  for (const write of writes) await apply(tx, write);
};
