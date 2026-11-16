import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import type { TabStore, SanctionCommandFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  sanctionCommandEnvelopeSchema,
  sanctionCommandCatalogue,
  type SanctionCommand,
} from '@daisy/protocol/lobby/sanction-command';
import {
  decideRequestSanction,
  decideSettleSanction,
  type SanctionWrite,
  type RequestSanctionFacts,
} from '../commands/sanction';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { commandDigest } from './command-digest';
import { eventSettingResolution } from './event-setting-resolution';
import { hostLobbyResource } from './host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

const pins = (row: {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
}) => ({
  formatVersionId: JSON.stringify([row.formatId, row.formatVersion]),
  ballotDefinitionVersionId: JSON.stringify([
    row.ballotDefinitionId,
    row.ballotDefinitionVersion,
  ]),
});
const checkOf = (
  facts: SanctionCommandFacts,
): RequestSanctionFacts['check'] => ({
  template: {
    ...pins(facts.template),
    enforced: facts.templateSettings
      .filter((row) => row.hold === 'enforced')
      .map((row) => ({ key: row.key, value: row.value })),
  },
  event: {
    ...pins(facts.configuration.event),
    resolved: eventSettingResolution(facts.configuration).settings,
  },
});
export const sanctionCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'sanctionCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly newId: () => string;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly organizationId: string; readonly lobbyId: string },
    body: unknown,
  ) => {
    const parsed = sanctionCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const { command } = parsed.data;
    if (
      command.type === 'request-sanction' &&
      command.leagueId !== input.organizationId
    )
      throw new CommandDenied('not-found');
    const newId = dependencies.newId();
    let now = '';
    const never = (): never => {
      throw createAppError(
        'INVARIANT',
        'Sanction commands have no fixture conflict',
      );
    };
    return runLobbyCommand<
      SanctionCommand,
      SanctionCommandFacts,
      string,
      SanctionWrite
    >(
      {
        authorize: dependencies.authorize,
        digest: commandDigest,
        now: () => now,
        transaction: (work) =>
          dependencies.store.sanctionCommand(
            { senderUserId: principal.userId, ...input, command },
            (session) =>
              work({
                facts: async () => {
                  const f = await session.load();
                  if (!f) throw new CommandDenied('not-found');
                  now = f.now;
                  return f;
                },
                authority: (f) => {
                  const request = command.type === 'request-sanction';
                  const organization = f.organization.organization;
                  const resource = request
                    ? hostLobbyResource(
                        f.lobby.lobby,
                        f.lobby.authorization.organization,
                        f.lobby.ownerActorId,
                      )
                    : organization;
                  if (!resource) throw new CommandDenied('not-found');
                  const auth = request ? f.lobby.authorization : f.organization;
                  const authority = {
                    principal,
                    resource,
                    context: {
                      account: auth.account,
                      grants: auth.grants,
                      now: f.now,
                    },
                  };
                  if (
                    !sanctionCommandCatalogue[command.type].gate.some(
                      (capability) =>
                        dependencies.authorize({ ...authority, capability })
                          .allow,
                    )
                  )
                    throw new CommandDenied('not-found');
                  return authority;
                },
                stored: session.stored,
                versions: (f) => ({ sanction: f.sanction?.version ?? 0 }),
                scope: () =>
                  command.type === 'request-sanction'
                    ? { kind: 'lobby', lobbyId: input.lobbyId }
                    : {
                        kind: 'organization',
                        organizationId: input.organizationId,
                      },
                recordConflict: never,
                holdForConfirmation: never,
                apply: session.apply,
              }),
          ),
      },
      parsed.data,
      sanctionCommandCatalogue[command.type],
      (f, c) =>
        c.type === 'request-sanction'
          ? decideRequestSanction(
              {
                now: f.now,
                mintedSanctionId: newId,
                event: f.configuration.event,
                template: f.template,
                season: f.season,
                existing: f.sanction,
                check: checkOf(f),
              },
              c,
            )
          : f.sanction
            ? decideSettleSanction(
                {
                  now: f.now,
                  sanction: f.sanction,
                  check: checkOf(f),
                  eventCertified: f.eventCertified,
                },
                c,
              )
            : { kind: 'refused', refusal: 'not-found' },
    );
  };
