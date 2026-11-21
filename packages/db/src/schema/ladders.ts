import { foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './columns';
import { lobbies } from './lobbies';
import { constantText, nonEmpty } from './tenant-keys';

/** A standing lobby's competition ladder, owned by the lobby's league. */
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
    unique('ladders_id_lobby_unique').on(table.id, table.lobbyId),
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
