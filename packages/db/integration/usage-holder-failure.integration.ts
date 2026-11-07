import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sql } from 'drizzle-orm';
import { withBoundedRound } from './bounded-transaction.test-support';
import { withHeldCommit } from './usage-ledger.test-support';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { causeChainMember } from '../src/capacity-refusal';

setupRitewayBun();
requireTestServices(process.env);

for (const failure of ['acquisition', 'statement'] as const) {
  test(`held writer ${failure} failure rejects entry and cleans up before returning`, async () => {
    await withBoundedRound(async (f, run, roundId) => {
      const acquisitionError = new Error('injected holder acquisition failure');
      const failing: BoundedTransaction =
        failure === 'acquisition'
          ? () => Promise.reject(acquisitionError)
          : run;
      let settled = false;
      let entryError: unknown;
      try {
        await withHeldCommit(failing, async (held) => {
          held.observe(
            held
              .run(async (tx) => {
                await tx.execute(
                  sql`update rounds set version=version+1 where id=${roundId}`,
                );
                await tx.execute(sql`select 1/0`);
              })
              .finally(() => {
                settled = true;
              }),
          );
          // The regression must itself clean up even when the old lost-entry bug returns.
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              held.entered,
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('Holder entry remained unresolved')),
                  3500,
                );
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
          throw new Error('failed holder must never signal entry');
        });
      } catch (error) {
        entryError = error;
      }
      const [row] = await f.sql`select version from rounds where id=${roundId}`;
      const followup = await run(async (tx) => {
        const [current] = await tx.execute(
          sql`select version from rounds where id=${roundId} for update`,
        );
        return current;
      });
      assert({
        given: `a real bounded holder with ${failure} failure before its entry signal`,
        should:
          'reject with the original failure, settle the holder, roll back and leave the row lock usable',
        actual: [
          failure === 'acquisition'
            ? entryError === acquisitionError
            : causeChainMember(
                (error) => 'errno' in error && error.errno === '22012',
                entryError,
              ) !== undefined,
          settled,
          row.version,
          followup,
        ],
        expected: [true, true, 1, { version: 1 }],
      });
    });
  });
}
