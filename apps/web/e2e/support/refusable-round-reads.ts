import { refuseCapacity } from '@daisy/db/testing';
import type { App } from '../../src/server/app';

/**
 * Puts the Round read behind a switch in this fixture's own process: refused,
 * it answers the real admission refusal, work that never ran. Everything
 * outward of the database (route, read, page) runs unchanged.
 */
export function refusableRoundReads(
  database: Pick<App['database'], 'readLaunchedRound'>,
) {
  const read = database.readLaunchedRound.bind(database);
  let refusing = false;
  database.readLaunchedRound = (...input) =>
    refusing
      ? Promise.reject(
          refuseCapacity({ lane: 'competitive', reason: 'saturated' }),
        )
      : read(...input);
  return {
    refuse: () => {
      refusing = true;
    },
    allow: () => {
      refusing = false;
    },
  };
}
