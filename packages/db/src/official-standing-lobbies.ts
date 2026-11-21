import { and, asc, eq, isNull } from 'drizzle-orm';
import { lobbies } from './schema/lobbies';
import { organizations } from './schema/organizations';
import type { Tx } from './tx';

export const readOfficialStandingLobbies = (db: Pick<Tx, 'select'>) =>
  db
    .select({
      id: lobbies.id,
      name: lobbies.name,
      handle: lobbies.handle,
      ageRule: lobbies.ageRule,
      organizationId: organizations.id,
    })
    .from(lobbies)
    .innerJoin(organizations, eq(organizations.id, lobbies.ownerOrganizationId))
    .where(
      and(
        eq(organizations.official, true),
        eq(lobbies.kind, 'standing'),
        isNull(lobbies.closedAt),
        isNull(organizations.closedAt),
      ),
    )
    .orderBy(asc(lobbies.createdAt), asc(lobbies.id));
