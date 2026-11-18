import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  GuardianPeopleChanged,
  type LoadedGuardianCommand,
  type GuardianCommandWrite,
  type TabStore,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  guardianCommandCatalogue,
  guardianCommandEnvelopeSchema,
  type GuardianCommand,
  type GuardianRefusal,
} from '@daisy/protocol/lobby/guardian-command';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import { decideGuardian } from '../commands/guardian';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';
type Dependencies = {
  readonly store: Pick<TabStore, 'guardianCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
  readonly minorsReleased: (userId: string) => Promise<boolean>;
  /** Null until counsel supplies the approved notice; no consent evidence is invented. */
  readonly consentNoticeVersion: number | null;
};
const neverHeld = (): never => {
  throw createAppError(
    'INVARIANT',
    'A family command cannot hold an officiating conflict',
  );
};
/** Family writes remain closed in production; tests supply their own explicit policy and owner privilege. */
export const guardianCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    subjectUserId: string,
    body: unknown,
  ): Promise<LobbyCommandAnswer<GuardianRefusal | 'not-found'>> => {
    const consentNoticeVersion = dependencies.consentNoticeVersion;
    if (
      !(await dependencies.minorsReleased(principal.userId)) ||
      consentNoticeVersion === null
    )
      throw new CommandDenied('not-found');
    const parsed = guardianCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success || !idSchema.safeParse(subjectUserId).success)
      throw createAppError('VALIDATION');
    if (
      parsed.data.command.type === 'create-guardian-link' &&
      parsed.data.command.wardUserId !== subjectUserId
    )
      throw new CommandDenied('not-found');
    const envelope = parsed.data,
      newId = dependencies.newId();
    let now = dependencies.now();
    try {
      return await dependencies.store.guardianCommand(
        {
          senderUserId: principal.userId,
          subjectUserId,
          command: envelope.command,
          newId,
        },
        async (session) =>
          runLobbyCommand<
            GuardianCommand,
            LoadedGuardianCommand,
            GuardianRefusal | 'not-found',
            GuardianCommandWrite
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => now,
              transaction: (work) =>
                work({
                  facts: async () => {
                    const loaded = await session.load();
                    now = dependencies.now();
                    if (!loaded) throw new CommandDenied('not-found');
                    return loaded;
                  },
                  stored: session.stored,
                  authority: (facts) => {
                    if (!facts.guardianActorId || !facts.wardActorId)
                      throw new CommandDenied('not-found');
                    return {
                      principal,
                      resource: {
                        kind: 'guardian_link',
                        guardianActorId: facts.guardianActorId,
                        wardActorId: facts.wardActorId,
                        via: facts.authorization.organization,
                      },
                      context: {
                        account: facts.authorization.account,
                        grants: facts.authorization.grants,
                        now,
                      },
                    };
                  },
                  versions: (facts) =>
                    facts.link ? { guardianLink: facts.link.version } : {},
                  scope: (facts) => ({
                    kind: 'person',
                    subjectUserId: facts.subjectUserId,
                  }),
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
            },
            envelope,
            guardianCommandCatalogue[envelope.command.type],
            (facts, command) => {
              if (
                !facts.ward ||
                facts.ward.erased ||
                !facts.guardian ||
                facts.guardian.erased
              )
                throw new CommandDenied('not-found');
              return decideGuardian(
                {
                  now,
                  newId,
                  link: facts.link,
                  wardAgeBand: facts.ward.ageBand,
                  guardianAgeBand: facts.guardian.ageBand,
                  guardianSchoolMembership: facts.guardianSchoolMembership,
                  openLinkExists: facts.openLinkExists,
                  wardOtherActiveLinks: facts.wardOtherActiveLinks,
                  consentNoticeVersion,
                  lobbies: facts.lobbies,
                  restriction: facts.restriction,
                },
                command,
              );
            },
          ),
      );
    } catch (error) {
      if (error instanceof GuardianPeopleChanged)
        return { kind: 'refused', refusal: 'version-conflict' };
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
