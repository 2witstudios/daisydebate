import {
  type AuthorizationDecision,
  type AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type TabStore,
  type LoadedJudgeRegistration,
  type JudgeRegistrationCommand,
  type JudgeRegistrationWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  judgeCommandCatalogue,
  judgeCommandSchema,
} from '@daisy/protocol/lobby/entry-command';
import {
  lobbyCommandEnvelope,
  type LobbyCommandAnswer,
} from '@daisy/protocol/lobby/command';
import {
  decideJudge,
  judgeAuthorityContext,
  judgeAuthorityTarget,
  type JudgeFacts,
} from '../commands/judges';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';
import { commandDigest } from './command-digest';
import { hostLobbyResource } from './host-lobby-resource';

type Loaded = LoadedJudgeRegistration & { readonly minorsAllowed: boolean };
type Dependencies = {
  readonly store: Pick<TabStore, 'judgeRegistrationCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
  readonly minorsReleased: (userId: string) => Promise<boolean>;
};
const judgeCommandEnvelopeSchema = lobbyCommandEnvelope(judgeCommandSchema);
const isRegistration = (command: {
  readonly type: string;
}): command is JudgeRegistrationCommand =>
  [
    'invite-judge',
    'remove-judge',
    'accept-judge-invitation',
    'decline-judge-invitation',
    'set-judge-availability',
  ].includes(command.type);
const isExit = (command: JudgeRegistrationCommand) =>
  command.type === 'remove-judge' ||
  command.type === 'decline-judge-invitation';
const neverHeld = (): never => {
  throw createAppError(
    'INVARIANT',
    'Judge registration has no fixture conflict',
  );
};
const factsOf = (
  loaded: Loaded,
  principal: TabPrincipal,
  lobbyId: string,
  newId: string,
): JudgeFacts => ({
  lobbyId,
  newJudgeId: newId,
  sender: { actorId: principal.actorId ?? '' },
  eventIds: loaded.eventIds,
  timeSlotIds: loaded.timeSlotIds,
  entry: null,
  judge: loaded.judge
    ? {
        id: loaded.judge.id,
        actorId: loaded.judge.actorId,
        status: loaded.judge.status,
        version: loaded.judge.version,
        availability: loaded.availability.map((row) => ({
          timeSlotId: row.timeSlotId,
          available: row.available,
        })),
        liveFixtures: [...new Set(loaded.fixtures.map((row) => row.id))].map(
          (id) => ({
            fixtureId: id,
            timeSlotId:
              loaded.fixtures.find((row) => row.id === id)?.timeSlotId ?? null,
            entryIds: loaded.fixtures
              .filter((row) => row.id === id)
              .flatMap((row) => (row.entryId === null ? [] : [row.entryId])),
          }),
        ),
      }
    : null,
});
const authorityOf = (
  loaded: Loaded,
  principal: TabPrincipal,
  command: JudgeRegistrationCommand,
  now: string,
): Omit<AuthorizationInput, 'capability'> => {
  const lobby = hostLobbyResource(
    loaded.lobby,
    loaded.authorization.organization,
    loaded.ownerActorId,
  );
  const target = judgeAuthorityTarget(command);
  if (target.kind === 'entry')
    throw createAppError('INVARIANT', 'Entry strikes use their own operation');
  const resource =
    target.kind === 'lobby'
      ? lobby
      : lobby.kind === 'lobby' &&
          lobby.scope.lobbyKind === 'tournament' &&
          loaded.judge
        ? {
            kind: 'judge' as const,
            scope: lobby.scope,
            actorId: loaded.judge.actorId,
          }
        : null;
  if (resource === null) throw new CommandDenied('not-found');
  return {
    principal,
    resource,
    context: {
      account: loaded.authorization.account,
      grants: loaded.authorization.grants,
      now,
      ...judgeAuthorityContext(command),
    },
  };
};
export const judgeRegistrationCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = judgeCommandEnvelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      !isRegistration(parsed.data.command)
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
    const envelope = { ...parsed.data, command };
    let now = dependencies.now();
    const newId = dependencies.newId();
    try {
      return await runLobbyCommand<
        JudgeRegistrationCommand,
        Loaded,
        string,
        JudgeRegistrationWrite
      >(
        {
          authorize: dependencies.authorize,
          digest: commandDigest,
          now: () => now,
          transaction: (work) =>
            dependencies.store.judgeRegistrationCommand(
              { senderUserId: principal.userId, lobbyId, command, newId, now },
              (session) =>
                work({
                  stored: session.stored,
                  facts: async () => {
                    const loaded = await session.load();
                    const minorsAllowed =
                      isExit(command) ||
                      (loaded.account?.ageBand === 'adult' &&
                        loaded.account.boundary === null) ||
                      (loaded.account !== null &&
                        (await dependencies.minorsReleased(
                          loaded.account.userId,
                        )));
                    now = dependencies.now();
                    return { ...loaded, minorsAllowed };
                  },
                  authority: (loaded) =>
                    authorityOf(loaded, principal, command, now),
                  versions: () => ({}),
                  scope: ({ lobby }) => {
                    if (!lobby || lobby.kind !== 'tournament')
                      throw new CommandDenied('not-found');
                    return { kind: 'lobby', lobbyId: lobby.id };
                  },
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
            ),
        },
        envelope,
        judgeCommandCatalogue[command.type],
        (loaded, requested) => {
          if (loaded.lobby?.kind !== 'tournament')
            return { kind: 'refused', refusal: 'not-found' };
          if (loaded.lobby.closedAt !== null && !isExit(requested))
            return { kind: 'refused', refusal: 'lobby-closed' };
          if (
            requested.type === 'invite-judge' &&
            (!loaded.actor?.userId ||
              !loaded.account?.member ||
              loaded.account.erased ||
              !loaded.schoolFound)
          )
            return { kind: 'refused', refusal: 'not-found' };
          if (!isExit(requested) && !loaded.minorsAllowed)
            throw new CommandDenied('not-found');
          const decision = decideJudge(
            factsOf(loaded, principal, lobbyId, newId),
            requested,
          );
          if (decision.kind === 'refused') return decision;
          const writes = decision.writes.map(
            (write): JudgeRegistrationWrite => {
              if (write.table === 'events' || write.table === 'judge_strikes')
                throw createAppError(
                  'INVARIANT',
                  'Registration cannot change entry strikes',
                );
              return write;
            },
          );
          return {
            ...decision,
            writes: [
              ...writes,
              ...(loaded.actor?.userId
                ? [
                    {
                      table: 'users' as const,
                      op: 'update' as const,
                      id: loaded.actor.userId,
                      increment: 'version' as const,
                    },
                  ]
                : []),
            ],
          };
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
