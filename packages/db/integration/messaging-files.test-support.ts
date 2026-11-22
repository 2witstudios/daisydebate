import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { lockAuthorizationActors } from '../src/authorization';
import type { createMessagingTestFixture } from '../src/testing';
import {
  channelFileFrame,
  type FileFrame,
  type FilePolicy,
} from '../src/messaging-files';
import type { TxSource, Tx } from '../src/tx';

type Fixture = Awaited<ReturnType<typeof createMessagingTestFixture>>;
export function withFileProofTransaction<T>(
  database: TxSource,
  fixture: Fixture,
  work: (
    tx: Tx,
    counters: { channelId: string; changeVersion: number },
  ) => Promise<T>,
) {
  const { actorId, otherActorId, channelId } = fixture;
  return database.transaction(async (tx) => {
    await lockAuthorizationActors(tx, [actorId, otherActorId].sort(), {
      maxActors: 2,
    });
    await tx.execute(
      sql`select low_actor_id from contact_pairs where low_actor_id=${fixture.low} and high_actor_id=${fixture.high} for update`,
    );
    const rows = await tx.execute(
      sql`select c.id, s.change_version from messaging_channels c join messaging_channel_streams s on s.channel_id=c.id where c.id=${channelId} for update of c`,
    );
    return work(tx, {
      channelId,
      changeVersion: Number(rows[0]!.change_version),
    });
  });
}
export function withFileProofFrame<T>(
  database: TxSource,
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
  maxUploadsPerDay: 20,
};
