import { foreignKey, index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './columns';
import { fixtures } from './fixtures';
import { rooms } from './rooms';

/** Tab retains every genuine fixture Room after a restart replaces its current Room pointer. */
export const fixtureRoomSources = pgTable(
  'fixture_room_sources',
  {
    roomId: text('room_id').primaryKey(),
    fixtureId: text('fixture_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('fixture_room_sources_fixture_idx').on(
      table.fixtureId,
      table.lobbyId,
    ),
    index('fixture_room_sources_room_lobby_idx').on(
      table.roomId,
      table.lobbyId,
    ),
    index('fixture_room_sources_lobby_idx').on(table.lobbyId),
    foreignKey({
      name: 'fixture_room_sources_fixture_fk',
      columns: [table.fixtureId, table.lobbyId],
      foreignColumns: [fixtures.id, fixtures.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fixture_room_sources_room_fk',
      columns: [table.roomId, table.lobbyId],
      foreignColumns: [rooms.id, rooms.lobbyId],
    }).onDelete('restrict'),
  ],
);
