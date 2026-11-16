import {
  assessPendingProposer,
  type AuthorizationInput,
  type AuthorizationDecision,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  FixturePeopleChanged,
  type TabStore,
  type LoadedConfirmationCommand,
  type ConfirmationWrite,
  type ConfirmationOwnerEffects,
} from '@daisy/db/tab';
import { createAppError, createRefusal, isAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  confirmationCommandEnvelopeSchema,
  confirmationCommandCatalogue,
} from '@daisy/protocol/lobby/confirmation-command';
import { fixtureCommandDefinition } from '@daisy/protocol/lobby/fixture-command';
import { resultCommandCatalogue } from '@daisy/protocol/lobby/result-command';
import type { LobbyCommandDefinition } from '@daisy/protocol/lobby/command';
import {
  CommandDenied,
  runLobbyCommand,
  commandHistoryAuthority,
} from '../commands/run-command';
import {
  decideConfirm,
  decideSettle,
  decideConflictWaiver,
} from '../commands/confirmation';
import { decideFixture } from '../commands/fixture';
import { decideFixtureResult } from '../commands/result';
import { fixtureFacts } from './fixture-facts';
import { resultFacts } from './result-facts';
import { fixtureAuthority } from './fixture-authority';
import {
  fixtureOwnerEffects,
  requireFixtureAdmissions,
} from './fixture-owner-effects';
import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';

const originalCompetition = (loaded: LoadedConfirmationCommand) => {
  if (loaded.original.kind !== 'fixture') return loaded.original.facts;
  if (!loaded.original.facts) throw createAppError('INVARIANT');
  return loaded.original.facts.competition;
};
const originalDefinition = (
  loaded: LoadedConfirmationCommand,
): LobbyCommandDefinition => {
  switch (loaded.original.kind) {
    case 'fixture':
      return fixtureCommandDefinition(
        loaded.original.envelope.command.type,
        loaded.context.fixture.status,
      );
    case 'result':
      return resultCommandCatalogue[loaded.original.envelope.command.type];
    case 'waiver':
      return {
        ...confirmationCommandCatalogue['request-conflict-waiver'],
        gate: [loaded.original.envelope.command.capability],
      };
  }
};
const noConfirmerConflict = (): never => {
  throw createAppError(
    'INVARIANT',
    'A confirmer must be unconnected to the actual target',
  );
};

/** Confirm, decline or withdraw an addressed held command; requests for read waivers have their own producer. */
export const settlePendingCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'confirmationCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly newId: () => string;
  }) =>
  async (principal: TabPrincipal, lobbyId: string, body: unknown) => {
    const parsed = confirmationCommandEnvelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      parsed.data.command.type === 'request-conflict-waiver'
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command,
      resultId = dependencies.newId(),
      roomId = dependencies.newId(),
      waiverId = dependencies.newId();
    try {
      return await dependencies.store.confirmationCommand(
        {
          senderUserId: principal.userId,
          lobbyId,
          commandId: parsed.data.commandId,
          command,
        },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) throw new CommandDenied('not-found');
          const now = loaded.checkedAt,
            competition = originalCompetition(loaded),
            definition = originalDefinition(loaded);
          if (definition.gate.length !== 1)
            throw createAppError('INVARIANT', 'Held capability is ambiguous');
          const capability = definition.gate[0]!;
          const proposer: TabPrincipal = {
            kind: 'user',
            userId: loaded.pending.proposerUserId,
            actorId: loaded.proposerActorId,
          };
          const proposed = fixtureAuthority(competition, proposer, now);
          const actual = fixtureAuthority(
            {
              ...competition,
              authorization: loaded.authorization,
              connections: loaded.connections,
            },
            principal,
            now,
          );
          if (actual.resource.kind !== 'fixture')
            throw createAppError('INVARIANT');
          const authority = {
            ...actual,
            resource: {
              kind: 'pending_command' as const,
              proposerActorId: loaded.proposerActorId,
              capability,
              target: actual.resource,
            },
          };
          const settleDefinition = confirmationCommandCatalogue[command.type];
          if (
            !settleDefinition.gate.some(
              (gate) =>
                dependencies.authorize({ ...authority, capability: gate })
                  .allow,
            )
          )
            throw new CommandDenied('not-found');
          if (
            commandDigest({
              expected: loaded.original.envelope.expected,
              command: loaded.original.envelope.command,
            }) !== loaded.pending.payloadDigest
          )
            throw createAppError('INVARIANT', 'Stored proposal digest changed');
          const pending = {
            ...loaded.pending,
            expected: loaded.original.envelope.expected,
            expiresAt: loaded.pending.expiresAt.toISOString(),
          };
          const assess = (at: string) =>
            assessPendingProposer({
              ...proposed,
              context: { ...proposed.context, now: at },
              capability,
            });
          const authorizeAt = (at: string) => {
            if (
              !settleDefinition.gate.some(
                (gate) =>
                  dependencies.authorize({
                    ...authority,
                    context: { ...authority.context, now: at },
                    capability: gate,
                  }).allow,
              )
            )
              throw new CommandDenied('not-found');
            if (command.type === 'confirm-command') {
              if (Date.parse(at) >= Date.parse(pending.expiresAt))
                throw createRefusal('CONFLICT', 'pending-expired');
              if (
                loaded.proposer.deletedAt !== null ||
                assess(at).kind !== 'eligible'
              )
                throw new CommandDenied('proposer-unauthorized');
            }
          };
          const rerun = () => {
            const source = loaded.original;
            switch (source.kind) {
              case 'fixture':
                if (!source.facts) throw createAppError('INVARIANT');
                return decideFixture(
                  fixtureFacts(
                    { ...source.facts, checkedAt: now },
                    { commandId: pending.commandId, resultId, roomId },
                  ),
                  source.envelope.command,
                );
              case 'result':
                return decideFixtureResult(
                  resultFacts(source.facts, {
                    now,
                    commandId: pending.commandId,
                    resultId,
                  }),
                  source.envelope.command,
                );
              case 'waiver':
                return decideConflictWaiver(
                  {
                    now,
                    mintedConflictId: waiverId,
                    confirmerUserId: principal.userId,
                    conflict: loaded.conflict,
                    waiverHolds: loaded.waivers.some(
                      (row) =>
                        row.confirmedByUserId !== null &&
                        row.handling === 'second_confirms',
                    ),
                  },
                  source.envelope.command,
                );
            }
          };
          return runLobbyCommand<
            typeof command,
            LoadedConfirmationCommand,
            string,
            ConfirmationWrite
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => now,
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => loaded,
                  authority: () => authority,
                  versions: () => ({}),
                  scope: () => ({ kind: 'lobby', lobbyId }),
                  recordConflict: (conflict) =>
                    session.recordConflict({
                      conflict,
                      now,
                      newId: dependencies.newId,
                    }),
                  holdForConfirmation: noConfirmerConflict,
                  apply: (writes, history, receipt) => {
                    const originalWrites = writes.filter(
                      (write) =>
                        write.table !== 'pending_commands' &&
                        write.table !== 'action_history' &&
                        write.table !== 'conflicts',
                    );
                    let fixture: ConfirmationOwnerEffects['fixture'] = null;
                    if (
                      originalWrites.length &&
                      loaded.original.kind === 'fixture'
                    ) {
                      if (!loaded.original.facts)
                        throw createAppError('INVARIANT');
                      requireFixtureAdmissions(
                        loaded.original.facts,
                        loaded.original.envelope.command,
                        originalWrites,
                      );
                      fixture = fixtureOwnerEffects(
                        loaded.original.facts,
                        proposer,
                        {
                          command: loaded.original.envelope.command,
                          commandId: pending.commandId,
                          payloadDigest: pending.payloadDigest,
                          roomId,
                          newId: dependencies.newId,
                          authorize: authorizeAt,
                        },
                      );
                    }
                    return session.apply(writes, history, receipt, {
                      fixture,
                      authorize: authorizeAt,
                    });
                  },
                }),
            },
            { ...parsed.data, command },
            settleDefinition,
            () => {
              const settlement = {
                now,
                settlerUserId: principal.userId,
                pending,
              };
              if (command.type !== 'confirm-command')
                return decideSettle(settlement, command);
              const assessment = assess(now);
              return decideConfirm<
                string,
                Exclude<
                  ConfirmationWrite,
                  { readonly table: 'pending_commands' | 'action_history' }
                >
              >(
                {
                  ...settlement,
                  proposer: {
                    id: loaded.proposer.id,
                    deletedAt: loaded.proposer.deletedAt?.toISOString() ?? null,
                  },
                  proposerAuthorization:
                    assessment.kind === 'eligible'
                      ? {
                          allow: true,
                          authority: commandHistoryAuthority(
                            proposer,
                            assessment.authority,
                          ),
                        }
                      : { allow: false },
                  scope: { kind: 'lobby', lobbyId },
                  versions: definition.versions,
                  current: { fixture: loaded.context.fixture.version },
                  rerun: rerun(),
                },
                command,
              );
            },
          );
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return {
          kind: 'refused' as const,
          refusal: 'command-conflict' as const,
        };
      if (isAppError(error) && error.reason === 'pending-expired')
        return {
          kind: 'refused' as const,
          refusal: 'pending-expired' as const,
        };
      if (
        error instanceof EventSettingParentsChanged ||
        error instanceof FixturePeopleChanged
      )
        throw createAppError('CONFLICT', 'Pending source changed');
      throw error;
    }
  };
