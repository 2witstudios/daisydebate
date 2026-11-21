import { fixtureSchoolIds, loadFixtureAudience } from './fixture-audience';
import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { rounds } from '../schema/rounds';
import { entries, entryMembers } from '../schema/entries';
import { events, stages, tabRounds, timeSlots } from '../schema/events';
import { draws } from '../schema/draws';
import { lobbies, tournaments } from '../schema/lobbies';
import { fixtures, fixtureEntries, fixtureJudges } from '../schema/fixtures';
import { poolResolutions } from '../schema/resolution-pools';
import { rooms } from '../schema/rooms';
import { scopeTransaction } from '../tenant-scope';
import { releases } from '../schema/releases';
import { settings } from '../schema/settings';
import { tournamentJudges } from '../schema/tournament-judges';
import { loadLobbyAuthority } from './lobby-authority';
import { lockEventSettingContext } from './event-setting-context';
import { loadEventCompetition } from './event-competition';
import { inTransaction, type Tx, type TxOpener } from '../tx';

type TournamentInput = {
  readonly lobbyId: string;
  readonly viewerUserId: string;
  readonly viewerActorId: string;
};

async function loadFixtures(tx: Tx, lobbyId: string, roundId: string) {
  const published = and(
    eq(fixtures.lobbyId, lobbyId),
    eq(fixtures.tabRoundId, roundId),
    eq(fixtures.status, 'published'),
  );
  const rows = await tx
    .select({
      fixtureId: fixtures.id,
      roomId: fixtures.roomId,
      roomName: rooms.title,
      roomStatus: rooms.status,
      roundStage: rounds.currentStage,
      roundStatus: rounds.status,
      kind: fixtures.kind,
    })
    .from(fixtures)
    .leftJoin(rooms, eq(fixtures.roomId, rooms.id))
    .leftJoin(rounds, eq(rounds.roomId, rooms.id))
    .where(published)
    .orderBy(asc(fixtures.id));
  const sides = await tx
    .select({
      fixtureId: fixtureEntries.fixtureId,
      entryId: entries.id,
      name: entries.name,
    })
    .from(fixtureEntries)
    .innerJoin(fixtures, eq(fixtures.id, fixtureEntries.fixtureId))
    .innerJoin(entries, eq(entries.id, fixtureEntries.entryId))
    .where(published)
    .orderBy(asc(fixtureEntries.position));
  const judges = await tx
    .select({
      fixtureId: fixtureJudges.fixtureId,
      actorId: tournamentJudges.actorId,
      name: users.username,
    })
    .from(fixtureJudges)
    .innerJoin(fixtures, eq(fixtures.id, fixtureJudges.fixtureId))
    .innerJoin(
      tournamentJudges,
      eq(tournamentJudges.id, fixtureJudges.tournamentJudgeId),
    )
    .leftJoin(actors, eq(actors.id, tournamentJudges.actorId))
    .leftJoin(users, eq(users.id, actors.userId))
    .where(published);
  return { rows, sides, judges };
}

export type ParticipantFixtureFacts = Awaited<ReturnType<typeof loadFixtures>>;

async function loadTournament(tx: Tx, input: TournamentInput) {
  const facts = await loadLobbyAuthority(tx, input);
  if (
    !facts ||
    facts.lobby.kind !== 'tournament' ||
    facts.lobby.closedAt !== null
  )
    return null;
  const { lobby } = facts;
  const [tournament] = await tx
    .select({ status: tournaments.status })
    .from(tournaments)
    .where(eq(tournaments.lobbyId, lobby.id));
  if (!tournament) return null;
  const enrolled = await tx
    .select({
      entryId: entries.id,
      eventId: entries.eventId,
      name: entries.name,
      status: entries.status,
    })
    .from(entries)
    .innerJoin(entryMembers, eq(entryMembers.entryId, entries.id))
    .where(
      and(
        eq(entries.lobbyId, lobby.id),
        eq(entryMembers.actorId, input.viewerActorId),
        ne(entries.status, 'withdrawn'),
      ),
    );
  const [judge] = await tx
    .select({ status: tournamentJudges.status })
    .from(tournamentJudges)
    .where(
      and(
        eq(tournamentJudges.lobbyId, lobby.id),
        eq(tournamentJudges.actorId, input.viewerActorId),
      ),
    );
  const posting = await tx
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.key, 'audience.posting'),
        or(
          and(eq(settings.scopeKind, 'lobby'), eq(settings.lobbyId, lobby.id)),
          ...(lobby.ownerOrganizationId
            ? [
                and(
                  eq(settings.scopeKind, 'organization'),
                  eq(settings.organizationId, lobby.ownerOrganizationId),
                ),
              ]
            : []),
        ),
      ),
    );
  const openings = await tx
    .select({
      tabRoundId: releases.tabRoundId,
      audience: releases.audience,
      thing: releases.thing,
    })
    .from(releases)
    .where(eq(releases.lobbyId, lobby.id));
  return {
    ...facts,
    tournament,
    enrolled,
    judge,
    posting,
    openings,
  };
}

export type ParticipantTournamentFacts = NonNullable<
  Awaited<ReturnType<typeof loadTournament>>
>;

function loadSchedule(tx: Tx, lobbyId: string, roundId?: string) {
  return tx
    .select({
      eventId: events.id,
      event: events.name,
      entryKind: events.entryKind,
      entriesVersion: events.entriesVersion,
      roundId: tabRounds.id,
      round: tabRounds.name,
      number: tabRounds.number,
      stage: stages.kind,
      resolution: poolResolutions.text,
      published: exists(
        tx
          .select({ id: draws.id })
          .from(draws)
          .where(
            and(
              eq(draws.tabRoundId, tabRounds.id),
              eq(draws.status, 'published'),
            ),
          ),
      ).mapWith(Boolean),
      startsAt: timeSlots.startsAt,
    })
    .from(events)
    .leftJoin(tabRounds, eq(tabRounds.eventId, events.id))
    .leftJoin(stages, eq(stages.id, tabRounds.stageId))
    .leftJoin(
      poolResolutions,
      and(
        eq(poolResolutions.id, tabRounds.poolResolutionId),
        eq(poolResolutions.lobbyId, events.lobbyId),
        isNotNull(tabRounds.resolutionReleasedAt),
      ),
    )
    .leftJoin(timeSlots, eq(timeSlots.id, tabRounds.timeSlotId))
    .where(
      and(
        eq(events.lobbyId, lobbyId),
        roundId ? eq(tabRounds.id, roundId) : undefined,
      ),
    )
    .orderBy(asc(timeSlots.startsAt), asc(events.id), asc(tabRounds.number));
}

export const createParticipantTournamentStore = (database: TxOpener) => ({
  participantEventResults: <Answer>(
    input: TournamentInput & { readonly eventId: string },
    work: (
      facts: ParticipantTournamentFacts,
      competition: NonNullable<
        Awaited<ReturnType<typeof loadEventCompetition>>
      >,
      schedule: Awaited<ReturnType<typeof loadSchedule>>,
      fixtureAudience: (fixture: {
        readonly id: string;
        readonly tabRoundId: string;
      }) => ReturnType<typeof loadFixtureAudience>,
      readFixtures: (roundId: string) => ReturnType<typeof loadFixtures>,
    ) => Promise<Answer>,
  ) =>
    inTransaction(database, async (tx) => {
      // Acquire the event's shared parent fences in the same order as writers.
      const competition = await loadEventCompetition(tx, input);
      if (!competition) return null;
      const facts = await loadTournament(tx, input);
      if (!facts) return null;
      return work(
        facts,
        competition,
        await loadSchedule(tx, input.lobbyId),
        async (fixture) =>
          loadFixtureAudience(tx, {
            fixtureId: fixture.id,
            lobbyId: input.lobbyId,
            tabRoundId: fixture.tabRoundId,
            userId: input.viewerUserId,
            schoolIds: await fixtureSchoolIds(tx, fixture.id),
            scope: competition.configuration.scope,
            snapshot: true,
          }),
        (roundId) => loadFixtures(tx, input.lobbyId, roundId),
      );
    }),
  publicTournamentPosting: <Answer>(
    input: {
      readonly lobbyId: string;
      readonly eventId: string;
      readonly roundId: string;
    },
    work: (
      address: { readonly handle: string; readonly name: string },
      schedule: Awaited<ReturnType<typeof loadSchedule>>[number],
      fixtures: Awaited<ReturnType<typeof loadFixtures>>,
    ) => Answer,
  ) =>
    inTransaction(database, async (tx) => {
      await scopeTransaction(tx, { lobbyId: input.lobbyId });
      const [publication] = await tx
        .select({ handle: lobbies.handle, name: lobbies.name })
        .from(lobbies)
        .innerJoin(tournaments, eq(tournaments.lobbyId, lobbies.id))
        .innerJoin(releases, eq(releases.lobbyId, lobbies.id))
        .where(
          and(
            eq(lobbies.id, input.lobbyId),
            isNull(lobbies.closedAt),
            ne(tournaments.status, 'draft'),
            eq(releases.eventId, input.eventId),
            eq(releases.tabRoundId, input.roundId),
            eq(releases.thing, 'posting'),
            inArray(releases.audience, ['public', 'link']),
          ),
        )
        .limit(1);
      if (!publication) return null;
      const [schedule] = await loadSchedule(tx, input.lobbyId, input.roundId);
      if (!schedule?.published || schedule.eventId !== input.eventId)
        return null;
      return work(
        publication,
        schedule,
        await loadFixtures(tx, input.lobbyId, input.roundId),
      );
    }),
  tournamentDirectory: (after: string, limit: number) =>
    inTransaction(database, (tx) => {
      const cursor = alias(lobbies, 'directory_cursor');
      return tx
        .select({ id: lobbies.id })
        .from(lobbies)
        .innerJoin(tournaments, eq(tournaments.lobbyId, lobbies.id))
        .where(
          and(
            isNull(lobbies.closedAt),
            ne(tournaments.status, 'draft'),
            after
              ? gt(
                  lobbies.handle,
                  tx
                    .select({ handle: cursor.handle })
                    .from(cursor)
                    .where(eq(cursor.id, after)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(lobbies.handle))
        .limit(limit);
    }),
  participantTournament: <Answer>(
    input: TournamentInput,
    work: (
      facts: ParticipantTournamentFacts,
      schedule: () => ReturnType<typeof loadSchedule>,
      readFixtures: (roundId: string) => ReturnType<typeof loadFixtures>,
      eventSettings: (
        eventId: string,
      ) => ReturnType<typeof lockEventSettingContext>,
      fixtureAudience: (
        fixtureId: string,
        tabRoundId: string,
      ) => ReturnType<typeof loadFixtureAudience>,
    ) => Promise<Answer>,
  ) =>
    inTransaction(database, async (tx) => {
      const facts = await loadTournament(tx, input);
      return facts
        ? work(
            facts,
            () => loadSchedule(tx, facts.lobby.id),
            (roundId) => loadFixtures(tx, facts.lobby.id, roundId),
            (eventId) =>
              lockEventSettingContext(tx, {
                eventId,
                lobbyId: facts.lobby.id,
                subjectUserId: input.viewerUserId,
                snapshot: true,
              }),
            async (fixtureId, tabRoundId) =>
              loadFixtureAudience(tx, {
                fixtureId,
                tabRoundId,
                lobbyId: facts.lobby.id,
                userId: input.viewerUserId,
                schoolIds: await fixtureSchoolIds(tx, fixtureId),
                snapshot: true,
                scope: {
                  lobbyId: facts.lobby.id,
                  subjectUserId: input.viewerUserId,
                  organizationId: facts.lobby.ownerOrganizationId ?? undefined,
                },
              }),
          )
        : null;
    }),
});
