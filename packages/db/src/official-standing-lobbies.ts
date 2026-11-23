import { lobbyAgeRules } from '@daisy/protocol/lobby/eligibility';
import { roomChain } from '@daisy/protocol/setting-resolution';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { parsedColumn } from './raw-rows';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { standingLadderSetting } from './league-room-selection';
import { ladders } from './schema/ladders';
import { lobbies } from './schema/lobbies';
import { organizations } from './schema/organizations';
import { settings } from './schema/settings';
import type { Tx } from './tx';

const officialStanding = and(
  eq(organizations.official, true),
  eq(lobbies.kind, 'standing'),
  isNull(lobbies.closedAt),
  isNull(organizations.closedAt),
);

export const readOfficialStandingLobbies = (db: Pick<Tx, 'select'>) =>
  db
    .select({
      id: lobbies.id,
      name: lobbies.name,
      handle: lobbies.handle,
      ageRule: parsedColumn(z.enum(lobbyAgeRules), sql`${lobbies.ageRule}`),
      organizationId: organizations.id,
    })
    .from(lobbies)
    .innerJoin(organizations, eq(organizations.id, lobbies.ownerOrganizationId))
    .where(officialStanding)
    .orderBy(asc(lobbies.createdAt), asc(lobbies.id));

/** Resolve each official lobby's published ladder, falling back to its oldest. */
export async function readOfficialRatingLadderCatalog(db: Pick<Tx, 'select'>) {
  const organizationSetting = alias(settings, 'organization_setting');
  const lobbySetting = alias(settings, 'lobby_setting');
  const rows = await db
    .select({
      ladder: {
        id: ladders.id,
        name: ladders.name,
        lobbyId: lobbies.id,
        lobbyName: lobbies.name,
        ageRule: parsedColumn(z.enum(lobbyAgeRules), sql`${lobbies.ageRule}`),
        openedAt: lobbies.createdAt,
      },
      organizationId: organizations.id,
      organizationSetting,
      lobbySetting,
    })
    .from(lobbies)
    .innerJoin(organizations, eq(organizations.id, lobbies.ownerOrganizationId))
    .innerJoin(ladders, eq(ladders.lobbyId, lobbies.id))
    .leftJoin(
      organizationSetting,
      and(
        eq(organizationSetting.organizationId, organizations.id),
        eq(organizationSetting.scopeKind, 'organization'),
        eq(organizationSetting.key, 'standings.rating_ladder'),
      ),
    )
    .leftJoin(
      lobbySetting,
      and(
        eq(lobbySetting.lobbyId, lobbies.id),
        eq(lobbySetting.scopeKind, 'lobby'),
        eq(lobbySetting.key, 'standings.rating_ladder'),
      ),
    )
    .where(officialStanding)
    .orderBy(
      asc(lobbies.createdAt),
      asc(lobbies.id),
      asc(ladders.createdAt),
      asc(ladders.id),
    );
  const selected = new Map<
    string,
    { ladder: (typeof rows)[number]['ladder']; configuredId: string | null }
  >();
  for (const row of rows) {
    const { ladder, organizationId } = row;
    const { lobbyId } = ladder;
    const choice = selected.get(lobbyId);
    if (!choice) {
      const configuredId = standingLadderSetting(
        roomChain({ organizationId, lobbyId, templateId: null }),
        [row.organizationSetting, row.lobbySetting].filter(
          (value) => value !== null,
        ),
      );
      selected.set(lobbyId, { ladder, configuredId });
    } else if (ladder.id === choice.configuredId) {
      choice.ladder = ladder;
    }
  }
  return [...selected.values()].map(({ ladder }) => ladder);
}
