import { and, eq, inArray, sql } from 'drizzle-orm';
import { parsedColumn } from '../raw-rows';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { ageBands } from '@daisy/protocol/ladder';
import { mayDebate, isMinorAgeBand } from '@daisy/protocol/lobby/eligibility';
import { tournamentFirstDay } from '@daisy/protocol/lobby/tournament-schedule';
import { divisionAgeBand } from '../ladder-division-band';
import { readGuardianLobbyIds } from '../guardians/lobby-permissions';
import { accountAge } from '../schema/account-age';
import { actors } from '../schema/actors';
import { timeSlots } from '../schema/events';
import { lobbies } from '../schema/lobbies';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import type { Tx } from '../tx';

/** Resolve the live rule under the specific tournament's tenant and parent. */
export async function loadTournamentEligibility(
  tx: Tx,
  scope: TenantScope,
  lobby: typeof lobbies.$inferSelect,
) {
  if (lobby.ownerOrganizationId === null && lobby.ageRule !== null)
    return { kind: 'own' as const, lobbyId: lobby.id, ageRule: lobby.ageRule };
  if (lobby.standingLobbyId === null || lobby.ownerOrganizationId === null)
    throw createAppError('INVARIANT', 'Tournament standing lobby is missing');

  await scopeTransaction(tx, { ...scope, lobbyId: lobby.standingLobbyId });
  try {
    const [parent] = await tx
      .select({ id: lobbies.id, name: lobbies.name, ageRule: lobbies.ageRule })
      .from(lobbies)
      .where(
        and(
          eq(lobbies.id, lobby.standingLobbyId),
          eq(lobbies.kind, 'standing'),
          eq(lobbies.ownerOrganizationId, lobby.ownerOrganizationId),
        ),
      )
      .for('share');
    if (!parent || parent.ageRule === null)
      throw createAppError(
        'INVARIANT',
        'Tournament standing lobby has no age rule',
      );
    return {
      kind: 'standing' as const,
      lobbyId: parent.id,
      ageRule: parent.ageRule,
      lobbyName: parent.name,
    };
  } finally {
    await scopeTransaction(tx, scope);
  }
}

type TournamentEligibility = Awaited<
  ReturnType<typeof loadTournamentEligibility>
>;
type TournamentAgeSource =
  | { readonly kind: 'standing'; readonly lobbyId: string }
  | { readonly kind: 'own'; readonly ageAsOf: string };

export async function tournamentAgeSource(
  tx: Tx,
  eligibility: TournamentEligibility,
  now: string,
): Promise<TournamentAgeSource> {
  if (eligibility.kind === 'standing') return eligibility;
  const slots = await tx
    .select({ startsAt: timeSlots.startsAt })
    .from(timeSlots)
    .where(eq(timeSlots.lobbyId, eligibility.lobbyId));
  return {
    kind: 'own',
    ageAsOf: tournamentFirstDay(
      slots.map(({ startsAt }) => startsAt.toISOString()),
      now,
    ),
  };
}

export function tournamentDebaterAgeBand(source: TournamentAgeSource) {
  return source.kind === 'standing'
    ? divisionAgeBand(source.lobbyId)
    : parsedColumn(
        z.enum(ageBands).nullable(),
        sql`case when public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, clock_timestamp()) is null then null else public.daisy_age_band(${accountAge.birthMonth}, ${accountAge.version}, ${accountAge.recordedAt}, greatest(${source.ageAsOf}::timestamptz, ${accountAge.recordedAt})) end`,
      );
}

/** Call after authorization, with the named cast and competition already fenced. */
export async function tournamentDebatersAllowed(
  tx: Tx,
  scope: TenantScope,
  eligibility: TournamentEligibility,
  actorIds: readonly string[],
  now: string,
): Promise<boolean> {
  const ids = [...new Set(actorIds)];
  if (!ids.length) return true;
  const people = await tx
    .select({ userId: actors.userId })
    .from(actors)
    .where(inArray(actors.id, ids));
  if (people.length !== ids.length) return false;
  const source = await tournamentAgeSource(tx, eligibility, now);
  const band = tournamentDebaterAgeBand(source);
  try {
    for (const { userId } of people) {
      if (userId === null) return false;
      await scopeTransaction(tx, {
        ...scope,
        lobbyId: eligibility.lobbyId,
        subjectUserId: userId,
      });
      const [record] = await tx
        .select({ band })
        .from(accountAge)
        .where(eq(accountAge.userId, userId));
      const ageBand = record?.band ?? null;
      if (ageBand === null) return false;
      const guardianLobbyIds =
        eligibility.kind === 'standing' &&
        eligibility.ageRule === 'adults' &&
        isMinorAgeBand(ageBand)
          ? await readGuardianLobbyIds(tx, userId)
          : undefined;
      if (
        !mayDebate(
          { ageBand, guardianLobbyIds },
          { ...eligibility, competitionType: 'casual' },
        )
      )
        return false;
    }
    return true;
  } finally {
    await scopeTransaction(tx, scope);
  }
}
