import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  EntryEnrollmentChanged,
  type TabStore,
  type LoadedEntryEnrollment,
  type EntryEnrollmentCommand,
  type EntryEnrollmentWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import {
  entryCommandCatalogue,
  entryCommandEnvelopeSchema,
} from '@daisy/protocol/lobby/entry-command';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import { decideEntry } from '../commands/entries';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';
import { commandDigest } from '@daisy/digest';
import { entryEnrollmentFacts } from './entry-enrollment-facts';
import { entryEnrollmentAuthority } from './entry-enrollment-authority';
import { hostLobbyResource } from './host-lobby-resource';

type Dependencies = {
  readonly store: Pick<TabStore, 'entryEnrollmentCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
};
const isEnrollment = (command: {
  readonly type: string;
}): command is EntryEnrollmentCommand =>
  [
    'submit-entry',
    'accept-entry',
    'decline-entry',
    'withdraw-entry',
    'set-entry-division',
  ].includes(command.type);
const neverHeld = (): never => {
  throw createAppError('INVARIANT', 'Enrollment has no fixture conflict');
};
export const entryEnrollmentCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = entryCommandEnvelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      !isEnrollment(parsed.data.command)
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
    let now = dependencies.now();
    const newId = dependencies.newId();
    try {
      return await runLobbyCommand<
        EntryEnrollmentCommand,
        LoadedEntryEnrollment,
        string,
        EntryEnrollmentWrite
      >(
        {
          authorize: dependencies.authorize,
          digest: commandDigest,
          now: () => now,
          transaction: (work) =>
            dependencies.store.entryEnrollmentCommand(
              { senderUserId: principal.userId, lobbyId, command, now, newId },
              (session) =>
                work({
                  stored: session.stored,
                  facts: async () => {
                    const loaded = await session.load();
                    now = dependencies.now();
                    return loaded;
                  },
                  authority: (loaded) =>
                    entryEnrollmentAuthority(loaded, principal, command, now),
                  versions: ({ event }) =>
                    event ? { entries: event.entriesVersion } : {},
                  scope: ({ event }) => {
                    if (!event) throw new CommandDenied('not-found');
                    return { kind: 'lobby', lobbyId: event.lobbyId };
                  },
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
            ),
        },
        { ...parsed.data, command },
        entryCommandCatalogue[command.type],
        async (loaded, requested) => {
          const exit =
            requested.type === 'withdraw-entry' ||
            requested.type === 'decline-entry';
          if (!loaded.event || loaded.lobby?.kind !== 'tournament')
            return { kind: 'refused', refusal: 'not-found' };
          if (loaded.lobby.closedAt !== null && !exit)
            return { kind: 'refused', refusal: 'lobby-closed' };
          const host = dependencies.authorize({
            capability: 'tournament.entries.manage',
            principal,
            resource: hostLobbyResource(
              loaded.lobby,
              loaded.authorization.organization,
              loaded.ownerActorId,
            ),
            context: {
              account: loaded.authorization.account,
              grants: loaded.authorization.grants,
              now,
            },
          }).allow;
          const guardianPermittedActors =
            requested.type === 'submit-entry' ||
            requested.type === 'accept-entry'
              ? await loaded.readGuardianPermittedActors()
              : new Set<string>();
          const facts = entryEnrollmentFacts(loaded, {
            commandId: parsed.data.commandId,
            command: requested,
            now,
            newEntryId: newId,
            senderUserId: principal.userId,
            host,
            guardianPermittedActors,
          });
          const decision = decideEntry(facts, requested);
          if (decision.kind === 'refused') return decision;
          const writes = decision.writes.map((write): EntryEnrollmentWrite => {
            if (
              write.table === 'room_participants' ||
              write.table === 'time_slots' ||
              (write.table === 'entry_members' && write.op === 'delete')
            )
              throw createAppError(
                'INVARIANT',
                'Enrollment cannot replace seated people',
              );
            return write;
          });
          return {
            ...decision,
            writes: [
              ...writes,
              ...[
                ...new Set(
                  loaded.people.flatMap((person) =>
                    person.userId ? [person.userId] : [],
                  ),
                ),
              ].map((id) => ({
                table: 'users' as const,
                op: 'update' as const,
                increment: 'version' as const,
                id,
              })),
            ],
          };
        },
      );
    } catch (error) {
      if (
        error instanceof EventSettingParentsChanged ||
        error instanceof EntryEnrollmentChanged
      )
        return { kind: 'refused', refusal: 'version-conflict' };
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
