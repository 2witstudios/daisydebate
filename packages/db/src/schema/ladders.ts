import { foreignKey, index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './columns';
import { lobbies } from './lobbies';
import { constantText, nonEmpty } from './tenant-keys';

/**
 * A rating over one standing lobby's rated Rooms. It belongs to exactly one
 * standing lobby and to that lobby's organization; a tournament lobby never
 * owns one. Daisy's three keep the ids `freestyle`, `policy` and `value`.
 * Ratings stay Daisy-only by the ladder CHECKs on `ratings` and
 * `rating_changes`, so a league's ladder row may exist while nothing can be
 * posted to it.
 */
export const ladders = pgTable(
  'ladders',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    lobbyKind: constantText('lobby_kind', 'standing'),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('ladders_lobby_organization_idx').on(
      table.lobbyId,
      table.organizationId,
    ),
    index('ladders_lobby_kind_idx').on(table.lobbyId, table.lobbyKind),
    foreignKey({
      name: 'ladders_lobby_owner_fk',
      columns: [table.lobbyId, table.organizationId],
      foreignColumns: [lobbies.id, lobbies.ownerOrganizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ladders_standing_lobby_fk',
      columns: [table.lobbyId, table.lobbyKind],
      foreignColumns: [lobbies.id, lobbies.kind],
    }).onDelete('restrict'),
    nonEmpty('ladders_name_nonempty', table.name),
  ],
);
