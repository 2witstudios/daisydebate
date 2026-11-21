import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type TabStore,
  type LoadedLeagueSchoolCommand,
  type LeagueSchoolWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  leagueSchoolCommandEnvelopeSchema,
  leagueSchoolCommandCatalogue,
  type LeagueSchoolCommand,
  type LeagueSchoolRefusal,
} from '@daisy/protocol/lobby/league-school-command';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import { decideLeagueSchool } from '../commands/league-schools';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { commandDigest } from '@daisy/digest';
import type { TabPrincipal } from '../tab-principal';

type Dependencies = {
  readonly store: Pick<TabStore, 'leagueSchoolCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
};
const neverHeld = (): never => {
  throw createAppError(
    'INVARIANT',
    'League school commands cannot hold an officiating conflict',
  );
};
/** Each controller assents through its own evaluator target; every transition has one durable command receipt. */
export const leagueSchoolCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    body: unknown,
  ): Promise<LobbyCommandAnswer<LeagueSchoolRefusal>> => {
    const parsed = leagueSchoolCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const envelope = parsed.data;
    let checkedAt = dependencies.now();
    try {
      return await dependencies.store.leagueSchoolCommand(
        {
          senderUserId: principal.userId,
          command: envelope.command,
          newId: dependencies.newId(),
        },
        (session) =>
          runLobbyCommand<
            LeagueSchoolCommand,
            LoadedLeagueSchoolCommand,
            LeagueSchoolRefusal,
            LeagueSchoolWrite
          >(
            {
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => {
                    const facts = await session.load();
                    if (!facts || !facts.authorization.organization)
                      throw new CommandDenied('not-found');
                    checkedAt = facts.checkedAt;
                    return facts;
                  },
                  authority: (facts) => {
                    // `facts` refused a league with no organization already.
                    const organization = facts.authorization.organization;
                    if (!organization) throw new CommandDenied('not-found');
                    return {
                      principal,
                      resource: organization,
                      context: {
                        account: facts.authorization.account,
                        grants: facts.authorization.grants,
                        now: checkedAt,
                      },
                    };
                  },
                  versions: (facts) => ({
                    organization: facts.league.version,
                    ...(facts.membership
                      ? { membership: facts.membership.version }
                      : {}),
                  }),
                  scope: (facts) => ({
                    kind: 'organization',
                    organizationId: facts.league.id,
                  }),
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => checkedAt,
            },
            envelope,
            leagueSchoolCommandCatalogue[envelope.command.type],
            decideLeagueSchool,
          ),
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
