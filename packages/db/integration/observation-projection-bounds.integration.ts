import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { MAX_FORMAT_SEGMENTS } from '@daisy/protocol';
import { createObservationProjectionOperations } from '../src/observation-projection';
import { readObservationHeaders } from '../src/observation-headers';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const projectionOwner = (
  db: BunSQLDatabase,
): Pick<BunSQLDatabase, 'transaction'> => ({
  transaction: (work, options) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_projection`);
      return work(tx);
    }, options),
});

test('Round projection carries at most the accepted-format segment bound', async () => {
  await withFixture(url, async (f) => {
    const subject = await createAuthorizationSubject(f);
    const roundId = await f.round({
      created_by_actor_id: subject.actorId,
      visibility: 'public',
    });
    const segment = (index: number) =>
      f.insert('round_segments', {
        id: createId(),
        round_id: roundId,
        sequence: index,
        type: 'speech',
        rules_segment_key: `S${index}`,
        started_at: '2026-10-09T18:00:00.000Z',
        ended_at: '2026-10-09T18:01:00.000Z',
        duration_ms: 60_000,
      });
    for (let index = 0; index < MAX_FORMAT_SEGMENTS; index++)
      await segment(index);
    const db = drizzle({ client: f.sql }),
      reader = createObservationProjectionOperations(projectionOwner(db)),
      resource = { kind: 'round' as const, id: roundId };
    const read = async () => {
      const [header] = await readObservationHeaders(db, [resource]);
      return reader.readObservationProjection({
        base: {
          schema: 1,
          resource,
          partition: { kind: 'shared', policyKey: 'round-clock-v1' },
          disclosureRevision: header!.disclosureRevision,
          window: { after: null, limit: 1 },
        },
        minimumContentRevision: header!.contentRevision,
        purgeGeneration: header!.purgeGeneration,
      });
    };
    const bounded = await read();
    assert({
      given: `${MAX_FORMAT_SEGMENTS} executed segments`,
      should: 'return every segment with no continuation',
      actual: {
        segments: (bounded.rows[0]?.segments as unknown[]).length,
        continuation: bounded.continuation,
      },
      expected: { segments: MAX_FORMAT_SEGMENTS, continuation: null },
    });
    await segment(MAX_FORMAT_SEGMENTS);
    await assertRejects({
      given: 'one segment beyond the accepted-format bound',
      should: 'refuse the body as unavailable rather than truncate it',
      actual: read,
      code: 'INFRASTRUCTURE',
    });
  });
});
