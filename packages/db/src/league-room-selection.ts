import { and, eq, or } from 'drizzle-orm';
import { resolveSetting, roomChain } from '@daisy/protocol/setting-resolution';
import { type SettingRow, settingRowSchema } from '@daisy/protocol/settings';
import { ladders } from './schema/ladders';
import { lobbies } from './schema/lobbies';
import { organizations } from './schema/organizations';
import { settings } from './schema/settings';
import { scopeTransaction } from './tenant-scope';
import type { Tx } from './room-command-facts';

/** A league's own configured ladder; a foreign or Daisy ladder is never selectable. */
export async function leagueRoomSelection(
  tx: Tx,
  input: {
    readonly lobbyId: string;
    readonly templateId: string | null;
    readonly subjectUserId?: string;
  },
) {
  const [home] = await tx
    .select({ lobby: lobbies })
    .from(lobbies)
    .innerJoin(organizations, eq(organizations.id, lobbies.ownerOrganizationId))
    .where(
      and(
        eq(lobbies.id, input.lobbyId),
        eq(lobbies.kind, 'standing'),
        eq(organizations.kind, 'league'),
      ),
    );
  if (!home?.lobby.ownerOrganizationId) return null;
  await scopeTransaction(tx, {
    organizationId: home.lobby.ownerOrganizationId,
    lobbyId: home.lobby.id,
    subjectUserId: input.subjectUserId,
  });
  return configuredStandingLadder(tx, {
    ...input,
    organizationId: home.lobby.ownerOrganizationId,
  });
}

type StandingLadderScope = Parameters<typeof roomChain>[0];

export const standingLadderSetting = (
  chain: ReturnType<typeof roomChain>,
  rows: readonly (typeof settings.$inferSelect)[],
) =>
  resolveSetting(
    'standings.rating_ladder',
    chain,
    rows.map(
      (row) =>
        settingRowSchema.parse({
          scope: {
            kind: row.scopeKind,
            id:
              row.organizationId && row.scopeKind === 'organization'
                ? row.organizationId
                : row.scopeKind === 'template'
                  ? row.templateId
                  : row.lobbyId,
          },
          key: row.key,
          hold: row.hold,
          value: row.value,
        }) as SettingRow,
    ),
  ).value.ladderId;

/** Resolve the persisted setting against the exact standing lobby's ladders. */
export async function configuredStandingLadder(
  tx: Pick<Tx, 'select'>,
  input: StandingLadderScope,
) {
  const chain = roomChain(input);
  const rows = await tx
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.key, 'standings.rating_ladder'),
        or(
          ...chain.map((scope) =>
            scope.kind === 'organization'
              ? and(
                  eq(settings.scopeKind, scope.kind),
                  eq(settings.organizationId, scope.id),
                )
              : scope.kind === 'template'
                ? eq(settings.templateId, scope.id)
                : and(
                    eq(settings.scopeKind, scope.kind),
                    eq(settings.lobbyId, scope.id),
                  ),
          ),
        ),
      ),
    );
  const selected = standingLadderSetting(chain, rows);
  if (!selected) return null;
  const [ladder] = await tx
    .select({ id: ladders.id })
    .from(ladders)
    .where(
      and(
        eq(ladders.id, selected),
        eq(ladders.lobbyId, input.lobbyId),
        eq(ladders.organizationId, input.organizationId),
      ),
    );
  return ladder?.id ?? null;
}
