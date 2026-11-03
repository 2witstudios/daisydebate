import type { PrepSource } from '../source';
import type { ShareRecord, ShareTarget } from '../sharing';
import { permissions, type Permission } from '../sharing';
import type { Team } from './team';

/** The team seam: one team by id, or undefined. The backend read replaces it. */
export const getTeam = (source: PrepSource, id: string): Team | undefined =>
  source.teams.find((team) => team.id === id);

/** Teams the viewer belongs to, for the library's Teams card. */
export const listTeams = (source: PrepSource): readonly Team[] => source.teams;

/** The share seam: who a brief is shared with. Private with no record. */
export const getShare = (source: PrepSource, briefId: string): ShareRecord =>
  source.shares.find((s) => s.briefId === briefId) ?? {
    briefId,
    grants: [],
    includeCards: true,
    threads: [],
  };

const isPermission = (value: string): value is Permission =>
  (permissions as readonly string[]).includes(value);

/**
 * Checks a team or @handle typed into the add row. Sharing reaches only
 * teams the viewer belongs to and people by handle. The real check is the
 * server's; this reads the typed name.
 */
export function checkShareTarget(
  source: PrepSource,
  typed: string,
  permission: string,
): ShareTarget {
  const name = typed.trim();
  if (name === '') return { kind: 'none' };
  const level = isPermission(permission) ? permission : 'view';
  if (name.startsWith('@'))
    return /^@[a-z0-9][a-z0-9-]{1,30}$/.test(name) && name !== '@unknown'
      ? { kind: 'ready', name, permission: level }
      : { kind: 'unknown' };
  if (source.strangerTeamNames.includes(name))
    return { kind: 'not-a-member', teamName: name };
  if (listTeams(source).some((team) => team.name === name))
    return { kind: 'ready', name, permission: level };
  return { kind: 'invalid' };
}
