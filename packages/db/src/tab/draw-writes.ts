import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { RoomAssemblyState } from '@daisy/protocol';
import { assembleRoom } from '../room-assembly';
import { roomFacts } from '../room-command-facts';
import { persistRoomOutsideCommands } from '../room-mutation-persistence';
import { draws, drawFixtures, drawResultInputs } from '../schema/draws';
import { fixtures, fixtureEntries, fixtureJudges } from '../schema/fixtures';
import { releases } from '../schema/releases';
import { jsonObjectSchema } from '../schema/columns';
import { timeSlots } from '../schema/events';
import type { TabTransaction } from './tab-transaction';
import type { LoadedDrawCommand } from './draw-command-facts';
import type { DrawWrite } from './draw-write';

export type DrawRoomAssembly = {
  readonly rooms: readonly Parameters<typeof assembleRoom>[1][];
  readonly closeRoom: (room: RoomAssemblyState) => RoomAssemblyState;
  readonly activeRoomMembers: (room: RoomAssemblyState) => readonly string[];
};
const one = (rows: readonly unknown[]) => {
  if (rows.length !== 1)
    throw createAppError(
      'INVARIANT',
      'Draw write did not affect its fenced row',
    );
};
export const applyDrawWrites = async (
  tx: TabTransaction,
  loaded: LoadedDrawCommand,
  writes: readonly DrawWrite[],
  assembly: DrawRoomAssembly,
  now: string,
): Promise<void> => {
  for (const write of writes) {
    switch (write.table) {
      case 'draws':
        if (write.op === 'insert')
          await tx.insert(draws).values({
            ...write.row,
            inputs: jsonObjectSchema.parse(write.row.inputs),
          });
        else if (write.op === 'update')
          one(
            await tx
              .update(draws)
              .set({
                ...write.set,
                inputs: jsonObjectSchema.parse(write.set.inputs),
                publishedAt: new Date(write.set.publishedAt),
              })
              .where(eq(draws.id, write.where.id))
              .returning({ id: draws.id }),
          );
        else
          one(
            await tx
              .delete(draws)
              .where(eq(draws.id, write.where.id))
              .returning({ id: draws.id }),
          );
        break;
      case 'draw_fixtures':
        await tx.insert(drawFixtures).values(write.row);
        break;
      case 'draw_result_inputs':
        await tx.insert(drawResultInputs).values(write.row);
        break;
      case 'fixtures':
        if (write.op === 'insert') await tx.insert(fixtures).values(write.row);
        else if (write.op === 'delete')
          one(
            await tx
              .delete(fixtures)
              .where(eq(fixtures.id, write.where.id))
              .returning({ id: fixtures.id }),
          );
        else {
          const set =
            'publishedAt' in write.set
              ? { ...write.set, publishedAt: new Date(write.set.publishedAt) }
              : 'withdrawnAt' in write.set
                ? { ...write.set, withdrawnAt: new Date(write.set.withdrawnAt) }
                : write.set;
          one(
            await tx
              .update(fixtures)
              .set(set)
              .where(eq(fixtures.id, write.where.id))
              .returning({ id: fixtures.id }),
          );
        }
        break;
      case 'fixture_entries':
        if (write.op === 'insert')
          await tx.insert(fixtureEntries).values(write.row);
        else
          await tx
            .delete(fixtureEntries)
            .where(eq(fixtureEntries.fixtureId, write.where.fixtureId));
        break;
      case 'fixture_judges':
        if (write.op === 'insert')
          await tx.insert(fixtureJudges).values(write.row);
        else
          await tx
            .delete(fixtureJudges)
            .where(eq(fixtureJudges.fixtureId, write.where.fixtureId));
        break;
      case 'rooms':
        if (write.op === 'insert') {
          const plan = assembly.rooms.find(
            (room) => room.room.id === write.row.id,
          );
          const people = writes.flatMap((row) =>
            row.table === 'room_participants' && row.row.roomId === write.row.id
              ? [row.row.actorId]
              : [],
          );
          const cast = plan?.cast?.seats.map((seat) => seat.actorId) ?? [];
          if (
            !plan ||
            plan.lobby.id !== write.row.lobbyId ||
            plan.lobby.kind !== 'tournament' ||
            plan.room.hostActorId !== null ||
            plan.room.formatId !== write.row.formatId ||
            plan.room.formatVersion !== write.row.formatVersion ||
            plan.templateId !== write.row.templateId ||
            (plan.ballotDefinition?.id ?? null) !==
              write.row.ballotDefinitionId ||
            (plan.ballotDefinition?.version ?? null) !==
              write.row.ballotDefinitionVersion ||
            cast.length !== people.length ||
            people.some((id) => !cast.includes(id))
          )
            throw createAppError(
              'INVARIANT',
              'Event Room assembly differs from its published fixture',
            );
          await assembleRoom(tx, plan);
        } else {
          const row = loaded.rooms.find((room) => room.id === write.where.id);
          if (!row)
            throw createAppError(
              'INVARIANT',
              'Withdrawn fixture Room is missing',
            );
          const { state } = await roomFacts(tx, row);
          await persistRoomOutsideCommands(
            tx,
            state,
            assembly.closeRoom(state),
            assembly.activeRoomMembers,
            now,
          );
        }
        break;
      case 'room_participants':
        // The shared factory applies the pure seat transitions once, including active membership.
        break;
      case 'releases':
        await tx
          .insert(releases)
          .values({ ...write.row, openedAt: new Date(write.row.openedAt) });
        break;
      case 'time_slots':
        one(
          await tx
            .update(timeSlots)
            .set(write.set)
            .where(
              and(
                eq(timeSlots.id, write.where.id),
                eq(timeSlots.version, write.where.version),
              ),
            )
            .returning({ id: timeSlots.id }),
        );
        break;
    }
  }
};
