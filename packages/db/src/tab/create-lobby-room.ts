import { createAppError } from '@daisy/errors';
import type { FormatDefinition } from '@daisy/protocol';
import type { LobbyCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { lockAuthorizationActors } from '../authorization';
import { readDatabaseTime } from '../database-clock';
import { readFormatSelectionFacts } from '../format-operations';
import { readPublishedResolution } from '../published-resolutions';
import { readEntitlementGrants } from '../entitlement-grants';
import { assembleRoom } from '../room-assembly';
import { recordCaptureNotice } from '../agreement-signatures';
import {
  lockCommand,
  lockedAccount,
  publishDefinition,
} from '../room-command-facts';
import { loadStandingRoomDraft } from './standing-room-draft';
import { appendHistory, storedCommand } from './command-record';
import type { TabDatabase } from './tab-transaction';

export type CreateLobbyRoomCommand = Extract<
  LobbyCommand,
  { type: 'create-lobby-room' }
>;
export type LobbyRoomAssembly = Parameters<typeof assembleRoom>[1];
export const createLobbyRoomStore = (database: TabDatabase) => ({
  createLobbyRoom: <Answer>(
    input: {
      readonly senderUserId: string;
      readonly senderActorId: string;
      readonly commandId: string;
      readonly command: CreateLobbyRoomCommand;
    },
    work: (session: {
      readonly load: () => Promise<
        Awaited<ReturnType<typeof loadStandingRoomDraft>>
      >;
      readonly selectionFacts: (
        tuple: Parameters<typeof readFormatSelectionFacts>[1],
      ) => ReturnType<typeof readFormatSelectionFacts>;
      readonly publication: (
        id: string,
        kind: 'policy' | 'value',
      ) => ReturnType<typeof readPublishedResolution>;
      readonly grants: () => ReturnType<typeof readEntitlementGrants>;
      readonly now: () => Promise<string>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly apply: (
        assembly: LobbyRoomAssembly,
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
        definition: FormatDefinition | null,
        notice: {
          readonly id: string;
          readonly version: string;
          readonly words: string;
        } | null,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      await lockCommand(tx, input.commandId);
      const actorIds = [
        ...new Set([
          input.senderActorId,
          ...(input.command.room.cast ?? []).map((seat) => seat.actorId),
        ]),
      ];
      await lockAuthorizationActors(tx, actorIds, {
        maxActors: actorIds.length,
      });
      const caller = {
        userId: input.senderUserId,
        actorId: input.senderActorId,
      };
      const account = await lockedAccount(tx, caller);
      if (account?.actorId !== input.senderActorId)
        throw createAppError('NOT_FOUND');
      return work({
        load: () =>
          loadStandingRoomDraft(tx, {
            viewerUserId: input.senderUserId,
            lobbyId: input.command.lobbyId,
          }),
        selectionFacts: (tuple) => readFormatSelectionFacts(tx, tuple),
        publication: (id, kind) => readPublishedResolution(tx, id, kind),
        grants: () => readEntitlementGrants(tx, input.senderUserId),
        now: async () => (await readDatabaseTime(tx)).toISOString(),
        stored: (id) => storedCommand(tx, id),
        apply: async (assembly, history, receipt, definition, notice) => {
          if (definition)
            await publishDefinition(
              tx,
              assembly.room.formatId,
              input.senderActorId,
              definition,
            );
          await assembleRoom(tx, assembly);
          if (notice)
            await recordCaptureNotice(tx, {
              ...notice,
              userId: input.senderUserId,
              roomId: assembly.room.id,
              now: assembly.now,
            });
          await appendHistory(tx, history, receipt);
        },
      });
    }),
});
