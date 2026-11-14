import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { lobbies } from '../schema/lobbies';
import { events, stages, tabRounds, timeSlots } from '../schema/events';
import {
  ballotDefinitions,
  ballotDefinitionVersions,
} from '../schema/ballot-definitions';
import { resolutionPools, poolResolutions } from '../schema/resolution-pools';
import { jsonObjectSchema } from '../schema/columns';
import type { TabTransaction } from './tab-transaction';

import type { SetupWrite } from './setup-write';
const one = (rows: readonly unknown[]): void => {
  if (rows.length !== 1)
    throw createAppError('INVARIANT', 'Setup write did not affect one row');
};
const at = (instant: string | null) =>
  instant === null ? null : new Date(instant);
const apply = async (tx: TabTransaction, write: SetupWrite): Promise<void> => {
  switch (write.table) {
    case 'lobbies':
      return one(
        await tx
          .update(lobbies)
          .set(write.set)
          .where(eq(lobbies.id, write.id))
          .returning({ id: lobbies.id }),
      );
    case 'events':
      if (write.op === 'insert') {
        await tx.insert(events).values(write.row);
        return;
      }
      if (write.op === 'delete')
        return one(
          await tx
            .delete(events)
            .where(eq(events.id, write.id))
            .returning({ id: events.id }),
        );
      return one(
        await tx
          .update(events)
          .set(write.set)
          .where(eq(events.id, write.id))
          .returning({ id: events.id }),
      );
    case 'stages': {
      if (write.op === 'delete')
        return one(
          await tx
            .delete(stages)
            .where(eq(stages.id, write.id))
            .returning({ id: stages.id }),
        );
      const row = write.op === 'insert' ? write.row : write.set;
      const { windowOpensAt, windowClosesAt, ...rest } = row;
      const value = {
        ...rest,
        ...(windowOpensAt === undefined
          ? {}
          : { windowOpensAt: at(windowOpensAt) }),
        ...(windowClosesAt === undefined
          ? {}
          : { windowClosesAt: at(windowClosesAt) }),
      };
      if (write.op === 'insert') {
        await tx.insert(stages).values({
          ...write.row,
          windowOpensAt: at(write.row.windowOpensAt),
          windowClosesAt: at(write.row.windowClosesAt),
        });
        return;
      }
      return one(
        await tx
          .update(stages)
          .set(value)
          .where(eq(stages.id, write.id))
          .returning({ id: stages.id }),
      );
    }
    case 'tab_rounds':
      if (write.op === 'insert') {
        await tx.insert(tabRounds).values(write.row);
        return;
      }
      if (write.op === 'delete')
        return one(
          await tx
            .delete(tabRounds)
            .where(eq(tabRounds.id, write.id))
            .returning({ id: tabRounds.id }),
        );
      return one(
        await tx
          .update(tabRounds)
          .set(write.set)
          .where(eq(tabRounds.id, write.id))
          .returning({ id: tabRounds.id }),
      );
    case 'time_slots':
      if (write.op === 'insert') {
        await tx
          .insert(timeSlots)
          .values({ ...write.row, startsAt: new Date(write.row.startsAt) });
        return;
      }
      if (write.op === 'delete')
        return one(
          await tx
            .delete(timeSlots)
            .where(eq(timeSlots.id, write.id))
            .returning({ id: timeSlots.id }),
        );
      return one(
        await tx
          .update(timeSlots)
          .set({
            ...write.set,
            startsAt:
              write.set.startsAt === undefined
                ? undefined
                : new Date(write.set.startsAt),
          })
          .where(eq(timeSlots.id, write.id))
          .returning({ id: timeSlots.id }),
      );
    case 'ballot_definitions':
      if (write.op === 'insert') {
        await tx.insert(ballotDefinitions).values(write.row);
        return;
      }
      return one(
        await tx
          .update(ballotDefinitions)
          .set(write.set)
          .where(eq(ballotDefinitions.id, write.id))
          .returning({ id: ballotDefinitions.id }),
      );
    case 'ballot_definition_versions':
      await tx.insert(ballotDefinitionVersions).values({
        ...write.row,
        definition: jsonObjectSchema.parse(write.row.definition),
      });
      return;
    case 'resolution_pools':
      await tx.insert(resolutionPools).values(write.row);
      return;
    case 'pool_resolutions':
      if (write.op === 'insert') {
        await tx.insert(poolResolutions).values(write.row);
        return;
      }
      return one(
        await tx
          .update(poolResolutions)
          .set({ retiredAt: new Date(write.set.retiredAt!) })
          .where(eq(poolResolutions.id, write.id))
          .returning({ id: poolResolutions.id }),
      );
  }
};
export const applySetupWrites = async (
  tx: TabTransaction,
  writes: readonly SetupWrite[],
): Promise<void> => {
  for (const write of writes) await apply(tx, write);
};
