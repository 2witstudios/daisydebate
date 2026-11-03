import { refuseCapacity } from '@daisy/db/testing';
import type { App } from '../../src/server/app';

type Database = App['database'];
/** Puts one read behind a switch; refused, it answers the real admission refusal. */
function refusable<Name extends 'readLaunchedRound' | 'getActorByUserId'>(
  database: Pick<Database, Name>,
  name: Name,
) {
  const read = (
    database[name] as (...input: unknown[]) => Promise<unknown>
  ).bind(database);
  let refusing = false;
  (database[name] as unknown) = (...input: unknown[]) =>
    refusing
      ? Promise.reject(
          refuseCapacity({ lane: 'competitive', reason: 'saturated' }),
        )
      : read(...input);
  return (on: boolean) => {
    refusing = on;
  };
}

/**
 * Switches in this fixture's own process for work that never ran. Everything
 * outward of the database (identity, route, read, page) runs unchanged.
 */
export const refusableReads = (database: Database) => ({
  round: refusable(database, 'readLaunchedRound'),
  identity: refusable(database, 'getActorByUserId'),
});
