import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { lockAuthorizationActors } from '../src/authorization';
import type { createMessagingTestFixture } from '../src/testing';
import {
  channelFileFrame,
  type FileFrame,
  type FilePolicy,
} from '../src/messaging-files';

type Fixture = Awaited<ReturnType<typeof createMessagingTestFixture>>;
type ProofTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'execute'
>;
export function withFileProofTransaction<T>(
  database: BunSQLDatabase,
  fixture: Fixture,
  work: (
    tx: ProofTransaction,
    counters: { channelId: string; changeVersion: number },
  ) => Promise<T>,
) {
  const { actorId, otherActorId, channelId } = fixture;
  return database.transaction(async (tx) => {
    await lockAuthorizationActors(tx, [actorId, otherActorId].sort(), {
      maxActors: 2,
    });
    await tx.execute(
      sql`select low_actor_id from messaging_contact_pairs where low_actor_id=${fixture.low} and high_actor_id=${fixture.high} for update`,
    );
    const rows = await tx.execute(
      sql`select id, change_version from messaging_channels where id=${channelId} for update`,
    );
    return work(tx, {
      channelId,
      changeVersion: Number(rows[0]!.change_version),
    });
  });
}
export function withFileProofFrame<T>(
  database: BunSQLDatabase,
  fixture: Fixture,
  work: (frame: FileFrame) => Promise<T>,
  denied = false,
) {
  return withFileProofTransaction(database, fixture, (tx, counters) =>
    work(
      channelFileFrame(
        tx,
        {
          actorId: fixture.actorId,
          userId: fixture.userId,
          channelId: fixture.channelId,
        },
        counters,
        async () => {
          if (denied) throw createAppError('AUTHORIZATION');
        },
      ),
    ),
  );
}

export const fileDatabaseProofPolicy: FilePolicy = {
  maxFileBytes: 100,
  maxStoredBytes: 100,
  maxStoredFiles: 2,
  maxFilesPerMessage: 1,
  reservationMs: 1000,
  accessMs: 100,
  maxFilenameUnits: 50,
  maxImagePixels: 100,
  serviceMs: 1000,
};
