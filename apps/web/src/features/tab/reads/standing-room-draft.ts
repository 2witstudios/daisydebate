import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { StandingRoomDraftFacts, TabStore } from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol';
import { templateViewSchema } from '@daisy/protocol/lobby/template-read';
import { roomChain, resolveSetting } from '@daisy/protocol/setting-resolution';
import type { SettingScope } from '@daisy/protocol/settings';
import type { ReleaseAudience } from '@daisy/protocol/release-audience';
import type { CreateRoomReads } from '../league';
import type { TabPrincipal } from '../tab-principal';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { formatSettingDefaults } from '../operations/format-setting-defaults';
import { settingRow } from '../operations/setting-facts';
import { resolvedSettingsViewOf } from './resolved-settings';

const scopeName = (
  facts: StandingRoomDraftFacts,
  scope: SettingScope,
): string => {
  switch (scope.kind) {
    case 'organization':
      return (
        facts.graph.organizations.find((row) => row.id === scope.id)?.name ??
        scope.id
      );
    case 'template':
      return (
        facts.graph.templates.find((row) => row.id === scope.id)?.name ??
        scope.id
      );
    case 'lobby':
      return facts.lobby.name;
    case 'event':
      return scope.id;
  }
};
type Dependencies = {
  readonly store: Pick<TabStore, 'standingRoomDraft'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
};
export const readStandingRoomDraft =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly templateId: string },
  ): Promise<CreateRoomReads | null> => {
    if (
      !idSchema.safeParse(input.lobbyId).success ||
      !idSchema.safeParse(input.templateId).success
    )
      return null;
    const facts = await dependencies.store.standingRoomDraft({
      viewerUserId: principal.userId,
      lobbyId: input.lobbyId,
    });
    if (
      !facts ||
      facts.lobby.closedAt !== null ||
      !facts.authorization.organization ||
      !facts.lobby.ownerOrganizationId
    )
      return null;
    const offeredIds = new Set(facts.offered.map((row) => row.templateId));
    const offered = facts.graph.templates.filter(
      (row) => offeredIds.has(row.id) && row.retiredAt === null,
    );
    const template = offered.find((row) => row.id === input.templateId);
    if (!template) return null;
    const chain = roomChain({
      organizationId: facts.lobby.ownerOrganizationId,
      templateId: template.id,
      lobbyId: facts.lobby.id,
    });
    const rows = facts.graph.settings.map(settingRow);
    const format = formatSettingDefaults(
      facts.graph,
      template.formatId,
      template.formatVersion,
    );
    const posting = resolveSetting(
      'audience.posting',
      chain,
      rows,
      format,
    ).value;
    const lobby = hostLobbyResource(
      facts.lobby,
      facts.authorization.organization,
      null,
    );
    if (lobby.kind !== 'lobby') return null;
    const authority = {
      principal,
      resource: {
        ...lobby,
        viewing: {
          audiences: facts.authorization.organization.member
            ? ['participants' as const]
            : [],
          releases: [],
        },
        postingAudiences: (Object.keys(posting) as ReleaseAudience[]).filter(
          (audience) => posting[audience] !== 'never',
        ),
      },
      context: {
        account: facts.authorization.account,
        grants: facts.authorization.grants,
        now: dependencies.now(),
      },
    };
    const ask = (capability: AuthorizationInput['capability']) =>
      dependencies.authorize({ ...authority, capability }).allow;
    if (!ask('lobby.read') || !ask('lobby.room.create')) return null;
    const names = (scope: SettingScope) => scopeName(facts, scope);
    return {
      lobby: { name: facts.lobby.name, handle: facts.lobby.handle },
      draft: resolvedSettingsViewOf(
        {
          at: {
            kind: 'room_draft',
            lobbyId: facts.lobby.id,
            templateId: template.id,
          },
          chain,
          rows,
          format,
          scopeName: names,
          reads: 'room',
        },
        true,
      ),
      lobbySettings: resolvedSettingsViewOf(
        {
          at: { kind: 'lobby', id: facts.lobby.id },
          chain: roomChain({
            organizationId: facts.lobby.ownerOrganizationId,
            templateId: null,
            lobbyId: facts.lobby.id,
          }),
          rows,
          format,
          scopeName: names,
          reads: 'every',
        },
        false,
      ),
      templates: offered.map((row) =>
        templateViewSchema.parse({
          templateId: row.id,
          name: row.name,
          organization: {
            organizationId: row.organizationId,
            name: row.organizationName,
          },
          format: {
            formatId: row.formatId,
            formatVersion: row.formatVersion,
            name: row.formatName,
          },
          ballotDefinition:
            row.ballotDefinitionId === null
              ? null
              : {
                  ballotDefinitionId: row.ballotDefinitionId,
                  ballotDefinitionVersion: row.ballotDefinitionVersion,
                  name: row.ballotDefinitionName,
                },
          retiredAt: null,
          settings: rows
            .filter(
              (setting) =>
                setting.scope.kind === 'template' &&
                setting.scope.id === row.id,
            )
            .map(({ key, value, hold }) => ({ key, value, hold })),
          capabilities: {
            manage: (() => {
              const held = facts.templateAuthorizations.find(
                (one) => one.organizationId === row.organizationId,
              )?.authorization;
              return held?.organization
                ? dependencies.authorize({
                    principal,
                    capability: 'organization.manage',
                    resource: {
                      kind: 'template',
                      organization: held.organization,
                    },
                    context: {
                      account: held.account,
                      grants: held.grants,
                      now: authority.context.now,
                    },
                  }).allow
                : false;
            })(),
          },
        }),
      ),
    };
  };
