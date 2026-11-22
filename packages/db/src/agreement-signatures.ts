import { and, eq, inArray, sql } from 'drizzle-orm';
import { openRoomStatuses } from '@daisy/protocol/room-contract';
import { lockActiveLobbySeason } from './ladder-season';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { agreementSignatures } from './schema/agreement-signatures';
import { actors } from './schema/actors';
import { rooms, roomParticipants } from './schema/rooms';
import { transactionNow } from './room-command-facts';
import { query } from './raw-rows';
import { z } from 'zod';
import { inTransaction, type Tx, type TxOpener } from './tx';

/** Where a member stands on a version of the lobby's active season's waiver. */
export type ContentWaiverStanding = 'signed' | 'unsigned' | 'no-active-season';

export async function readContentWaiverStanding(
  tx: Tx,
  userId: string,
  version: string,
  lobbyId: string,
): Promise<ContentWaiverStanding> {
  const seasonId = await lockActiveLobbySeason(tx, lobbyId);
  if (!seasonId) return 'no-active-season';
  const [row] = await tx
    .select({ id: agreementSignatures.id })
    .from(agreementSignatures)
    .where(
      and(
        eq(agreementSignatures.userId, userId),
        eq(agreementSignatures.agreement, 'ranked-content-waiver'),
        eq(agreementSignatures.version, version),
        eq(agreementSignatures.seasonId, seasonId),
      ),
    );
  return row ? 'signed' : 'unsigned';
}

/** Records the notice a member was shown, once per member, version and Room. */
export async function recordCaptureNotice(
  tx: Tx,
  input: {
    readonly id: string;
    readonly userId: string;
    readonly version: string;
    readonly words: string;
    readonly roomId: string;
    readonly now: string;
  },
) {
  await tx
    .insert(agreementSignatures)
    .values({
      id: input.id,
      userId: input.userId,
      agreement: 'round-capture-notice',
      version: input.version,
      words: input.words,
      roomId: input.roomId,
      signedAt: new Date(input.now),
    })
    .onConflictDoNothing();
}

export const agreementSignatureOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxOpener;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => {
  return {
    readContentWaiverStanding: (
      userId: string,
      version: string,
      lobbyId: string,
    ) =>
      instrumented(eventSink, 'readContentWaiverStanding', () =>
        inTransaction(database, (tx) =>
          readContentWaiverStanding(tx, userId, version, lobbyId),
        ),
      ),
    /** Signs for the active season; signing again keeps the first signature. */
    signContentWaiver: (input: {
      readonly id: string;
      readonly userId: string;
      readonly version: string;
      readonly words: string;
      readonly roomId: string;
    }): Promise<'signed' | 'no-active-season'> =>
      instrumented(eventSink, 'signContentWaiver', () =>
        inTransaction(database, async (tx) => {
          const [room] = await tx
            .select({ lobbyId: rooms.lobbyId })
            .from(rooms)
            .innerJoin(roomParticipants, eq(roomParticipants.roomId, rooms.id))
            .innerJoin(actors, eq(actors.id, roomParticipants.actorId))
            .where(
              and(
                eq(rooms.id, input.roomId),
                eq(rooms.competitionType, 'ranked'),
                inArray(rooms.status, [...openRoomStatuses]),
                eq(actors.userId, input.userId),
              ),
            )
            .for('share', { of: [rooms, roomParticipants] });
          if (!room) return 'no-active-season';
          const seasonId = await lockActiveLobbySeason(tx, room.lobbyId);
          if (!seasonId) return 'no-active-season';
          await tx
            .insert(agreementSignatures)
            .values({
              id: input.id,
              userId: input.userId,
              agreement: 'ranked-content-waiver',
              version: input.version,
              words: input.words,
              seasonId,
              signedAt: new Date(await transactionNow(tx)),
            })
            .onConflictDoNothing();
          return 'signed';
        }),
      ),
  };
};

/**
 * Exported to their member and kept on erasure: a signature is the evidence
 * behind ranked content that outlives the account (compliance.md, proposed
 * until counsel reviews it). The row holds no email or name.
 */
export const agreementSignaturePrivacyAdopter: PrivacyAdopter = {
  id: 'agreement-signatures',
  phase: 'after-close',
  erase: async () => undefined,
  export: async (tx, subject) => ({
    agreement_signatures: exportRows(
      await query(
        tx,
        z.object({
          agreement: z.string(),
          version: z.string(),
          words: z.string(),
          season_id: z.string().nullable(),
          room_id: z.string().nullable(),
          lobby_id: z.string().nullable(),
          signed_at: z.date(),
        }),
        sql`select agreement,version,words,season_id,room_id,lobby_id,signed_at from ${agreementSignatures} where user_id=${subject.userId} order by signed_at, id`,
      ),
    ),
  }),
};
