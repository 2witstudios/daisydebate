import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sql } from 'drizzle-orm';
import type { ObservationBase, ObservationHeader } from '@daisy/protocol';
import { createObservationProjectionOperations } from '../src/observation-projection';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readObservationHeaders } from '../src/observation-headers';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
import { withFixture, type Fixture } from './constraint-helpers';

/** The actual projection runtime role, as the projection-profile pool runs it. */
export const projectionOwner = (
  db: BunSQLDatabase,
): Pick<BunSQLDatabase, 'transaction'> => ({
  transaction: (work, options) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_projection`);
      return work(tx);
    }, options),
});
const policyKeys = {
  room: 'room-safe-v1',
  round: 'round-clock-v1',
  channel: 'channel-messages-v1',
} as const;
function sharedPolicyKey(kind: ObservationHeader['resource']['kind']) {
  if (kind === 'inbox')
    throw new Error('Inbox has no shared projection partition');
  return policyKeys[kind];
}
/** A shared-partition descriptor bound to one committed header. */
export const projectionInput = (
  header: ObservationHeader,
  window: ObservationBase['window'] = { after: null, limit: 1 },
) => ({
  base: {
    schema: 1 as const,
    resource: header.resource,
    partition: {
      kind: 'shared' as const,
      policyKey: sharedPolicyKey(header.resource.kind),
    },
    disclosureRevision: header.disclosureRevision,
    window,
  },
  minimumContentRevision: header.contentRevision,
  purgeGeneration: header.purgeGeneration,
});
/** Read a resource's body against its current header under the projection role. */
export async function readCurrentProjection(
  db: BunSQLDatabase,
  resource: ObservationHeader['resource'],
  window?: ObservationBase['window'],
) {
  const [header] = await readObservationHeaders(db, [resource]);
  return createObservationProjectionOperations(
    projectionOwner(db),
  ).readObservationProjection(projectionInput(header!, window));
}
/** Both fixture actors' inbox headers, read through the bounded header provider. */
export function inboxHeaders(
  db: BunSQLDatabase,
  fixture: { readonly actorId: string; readonly otherActorId: string },
) {
  const resources = [fixture.actorId, fixture.otherActorId].map((id) => ({
    kind: 'inbox' as const,
    id,
  }));
  return () => readObservationHeaders(db, resources);
}
/** One isolated DM fixture with its actors' inbox header reader, always cleaned up. */
export const withInboxHeaders = (
  url: string,
  body: (input: {
    readonly f: Fixture;
    readonly fixture: Awaited<ReturnType<typeof createMessagingTestFixture>>;
    readonly read: ReturnType<typeof inboxHeaders>;
  }) => Promise<void>,
) =>
  withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql);
    try {
      await body({
        f,
        fixture,
        read: inboxHeaders(drizzle({ client: f.sql }), fixture),
      });
    } finally {
      await fixture.cleanup();
    }
  });
