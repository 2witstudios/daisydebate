import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { LoadedOrganizationCommand, TabStore } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import {
  organizationCommandCatalogue,
  organizationCommandEnvelopeSchema,
  type OrganizationCommand,
  type OrganizationRefusal,
} from '@daisy/protocol/lobby/organization-command';
import { decideOrganization } from '../commands/organization';
import { runLobbyCommand } from '../commands/run-command';
import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';
import { organizationAuthorityOf } from './organization-authority';

type OrganizationWrite = Extract<
  ReturnType<typeof decideOrganization>,
  { readonly kind: 'accepted' }
>['writes'][number];

export type OrganizationCommandAnswer = LobbyCommandAnswer<
  OrganizationRefusal | 'not-found'
>;

export type OrganizationCommandDependencies = {
  readonly store: Pick<TabStore, 'organizationCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  /** The cuid2 a command that inserts a row gives it. */
  readonly newId: () => string;
  /** Whether the account holds the hosting plan a league takes. */
  readonly hostingPlan: (userId: string) => Promise<boolean>;
};

/** Organization commands are never held: no conflict reaches them. */
const neverHeld = (): never => {
  throw new Error('An organization command records no conflict');
};

/**
 * Runs one organization or grant command (TAB-5.9) for a signed-in person:
 * the envelope is validated here, then replay, the gate, the version check,
 * the decision and the writes with their history entry run in one
 * transaction. A denial throws `CommandDenied`, which answers as not found.
 */
export const organizationCommand =
  (dependencies: OrganizationCommandDependencies) =>
  async (
    principal: TabPrincipal,
    body: unknown,
  ): Promise<OrganizationCommandAnswer> => {
    const parsed = organizationCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const envelope = parsed.data;
    const { command } = envelope;
    const now = dependencies.now();
    const newId = dependencies.newId();
    const hostingPlan = await dependencies.hostingPlan(principal.userId);
    return runLobbyCommand<
      OrganizationCommand,
      LoadedOrganizationCommand,
      OrganizationRefusal | 'not-found',
      OrganizationWrite
    >(
      {
        transaction: (work) =>
          dependencies.store.organizationCommand(
            { senderUserId: principal.userId, command, newId, now },
            (session) =>
              work({
                stored: session.stored,
                facts: session.load,
                authority: (loaded) =>
                  organizationAuthorityOf(principal, command, loaded, {
                    now,
                    hostingPlan,
                  }),
                versions: ({ decision }) =>
                  decision.organization === null
                    ? {}
                    : { organization: decision.organization.version },
                scope: ({ decision }) => ({
                  kind: 'organization',
                  organizationId: decision.organization?.id ?? newId,
                }),
                recordConflict: neverHeld,
                holdForConfirmation: neverHeld,
                apply: session.apply,
              }),
          ),
        authorize: dependencies.authorize,
        digest: commandDigest,
        now: () => now,
      },
      envelope,
      organizationCommandCatalogue[command.type],
      (loaded, decided) => decideOrganization(loaded.decision, decided),
    );
  };
