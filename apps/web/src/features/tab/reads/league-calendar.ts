import type { LeagueSeasonFacts } from '@daisy/db/tab';
import type { SeasonView } from '@daisy/protocol/lobby/season-read';
/** Explicit sanctions and automatically admitted events use their actual stored schedule and identity. */
export function projectLeagueCalendar(
  facts: Pick<LeagueSeasonFacts, 'calendar' | 'automaticCalendar' | 'events'>,
  templateId: string,
): SeasonView['calendar'] {
  const explicit = facts.calendar
    .filter((row) => row.sanction.templateId === templateId)
    .map((row) => ({
      lobbyId: row.lobby.id,
      handle: row.lobby.handle,
      name: row.lobby.name,
      when: { precision: 'day' as const, startsAt: row.startsAt.toISOString() },
      completed: facts.events.some(
        (event) =>
          event.competition.configuration.event.id === row.sanction.eventId &&
          event.certifiedAt !== null,
      ),
      sanction: row.sanction.status,
    }));
  const automatic = facts.automaticCalendar
    .filter(
      (row) =>
        row.templateId === templateId &&
        !explicit.some((existing) => existing.lobbyId === row.lobby.id),
    )
    .map((row) => ({
      lobbyId: row.lobby.id,
      handle: row.lobby.handle,
      name: row.lobby.name,
      when: { precision: 'day' as const, startsAt: row.startsAt.toISOString() },
      completed: row.certifiedAt !== null,
      sanction: null,
    }));
  return [
    ...new Map(
      [...explicit, ...automatic].map((row) => [row.lobbyId, row]),
    ).values(),
  ].sort(
    (a, b) =>
      a.when.startsAt.localeCompare(b.when.startsAt) ||
      a.handle.localeCompare(b.handle),
  );
}
