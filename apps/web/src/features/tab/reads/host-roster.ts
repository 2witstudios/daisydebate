import type { TabStore, HostRosterFacts } from '@daisy/db/tab';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import { isRoundOver, isRoundRunning, idSchema } from '@daisy/protocol';
import {
  hostRosterViewSchema,
  type HostRosterView,
  type JudgeSlot,
} from '@daisy/protocol/lobby/entry-read';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { eligibleTournamentActors } from '../operations/tournament-participant-admission';
import type { TabPrincipal } from '../tab-principal';

function project(
  f: HostRosterFacts,
  eventId: string | null,
  manage: boolean,
): HostRosterView {
  const eligible = eligibleTournamentActors(f.accounts);
  const judges = f.judges.filter(
    (j) => j.status === 'accepted' && eligible.has(j.actorId),
  );
  const entries = f.entries.filter(
    (e) => eventId === null || e.eventId === eventId,
  );
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key =
      entry.responsibleKind === 'school'
        ? `school:${entry.schoolOrganizationId}`
        : entry.responsibleKind === 'guardian'
          ? `guardian:${entry.guardianLinkId}`
          : 'self';
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  const schoolName = (id: string) =>
    f.schools.find((s) => s.id === id)?.name ?? 'School';
  const slots = [...f.slots].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
  );
  const judgeSlot = (
    judge: (typeof judges)[number],
    slotId: string,
  ): JudgeSlot => {
    const assignments = f.assignments.filter(
      (a) =>
        a.tournamentJudgeId === judge.id &&
        a.fixtureStatus !== 'withdrawn' &&
        f.rounds.some((r) => r.id === a.tabRoundId && r.timeSlotId === slotId),
    );
    for (const assignment of assignments) {
      const fixture = f.fixtures.find(
        (fi) => fi.id === assignment.fixtureId && fi.status !== 'withdrawn',
      );
      if (!fixture) continue;
      const round =
        f.roomRounds.find(
          (r) => r.roomId === fixture.roomId && r.completedAt === null,
        ) ?? f.roomRounds.filter((r) => r.roomId === fixture.roomId).at(-1);
      if (round && isRoundOver(round.status)) {
        if (
          f.submitted.some(
            (b) => b.roundId === round.id && b.actorId === judge.actorId,
          )
        )
          return { state: 'judged' };
        return { state: 'awaiting_result' };
      }
      if (round && isRoundRunning(round.status))
        return {
          state: 'judging',
          place:
            f.rounds.find((r) => r.id === fixture.tabRoundId)?.name ?? 'Room',
          late: null,
        };
      return {
        state: fixture.status === 'draft' ? 'in_draft' : 'waiting_for_start',
      };
    }
    if (
      f.submitted.some(
        (b) =>
          b.actorId === judge.actorId &&
          f.roomRounds.some(
            (r) =>
              r.id === b.roundId &&
              f.fixtures.some(
                (fi) =>
                  fi.roomId === r.roomId &&
                  f.rounds.some(
                    (tr) => tr.id === fi.tabRoundId && tr.timeSlotId === slotId,
                  ),
              ),
          ),
      )
    )
      return { state: 'judged' };
    return {
      state: f.availability.some(
        (a) =>
          a.tournamentJudgeId === judge.id &&
          a.timeSlotId === slotId &&
          a.available,
      )
        ? 'free'
        : 'away',
    };
  };
  return hostRosterViewSchema.parse({
    entries: {
      lobbyId: f.lobby.id,
      eventId,
      asOf: f.checkedAt,
      counts: {
        accepted: entries.filter((e) => e.status === 'accepted').length,
        pending: entries.filter((e) => e.status === 'pending').length,
        withdrawn: entries.filter((e) => e.status === 'withdrawn').length,
        judges: judges.length,
        rooms: f.fixtures.filter(
          (fi) =>
            fi.status === 'published' &&
            (eventId === null || fi.eventId === eventId) &&
            fi.roomId !== null,
        ).length,
        judgesNeeded: null,
      },
      groups: [...grouped.values()].map((rows) => {
        const first = rows[0]!;
        const makerIds = [
          ...new Set(
            rows.flatMap((e) =>
              e.submittedByUserId ? [e.submittedByUserId] : [],
            ),
          ),
        ];
        return {
          responsible:
            first.responsibleKind === 'school'
              ? {
                  kind: 'school',
                  organizationId: first.schoolOrganizationId!,
                  name: schoolName(first.schoolOrganizationId!),
                }
              : first.responsibleKind === 'guardian'
                ? { kind: 'guardian', name: 'Guardian-managed entries' }
                : { kind: 'self' },
          entryCount: rows.length,
          makers: makerIds.flatMap((id) =>
            f.makers.filter((m) => m.userId === id),
          ),
          unknownMakers: rows.filter(
            (e) =>
              e.submittedByUserId === null ||
              !f.makers.some((m) => m.userId === e.submittedByUserId),
          ).length,
          judgesOwed: null,
          judgesNamed:
            first.responsibleKind === 'school'
              ? judges.filter(
                  (j) => j.schoolOrganizationId === first.schoolOrganizationId,
                ).length
              : 0,
          entries: rows.map((e) => ({
            id: e.id,
            name: e.name,
            status: e.status,
            rating: null,
            events: f.events
              .filter((ev) => ev.id === e.eventId)
              .map((ev) => ({ id: ev.id, name: ev.name, label: ev.label })),
            minor: null,
            invitation: null,
          })),
        };
      }),
      groupsNotShown: 0,
      capabilities: { manageEntries: manage },
    },
    judges: {
      lobbyId: f.lobby.id,
      events: f.events.map((e) => ({ id: e.id, name: e.name, label: e.label })),
      timeSlots: slots.map((s) => ({
        id: s.id,
        name: s.name,
        judgesNeeded: null,
      })),
      counts: {
        debaters: f.entries.filter((e) => e.status !== 'withdrawn').length,
        judges: judges.length,
      },
      need: null,
      groups: [...new Set(judges.map((j) => j.schoolOrganizationId))].map(
        (schoolId) => ({
          responsible: schoolId
            ? {
                kind: 'school',
                organizationId: schoolId,
                name: schoolName(schoolId),
              }
            : { kind: 'unaffiliated' },
          judgesOwed: null,
          judgesNamed: judges.filter((j) => j.schoolOrganizationId === schoolId)
            .length,
          judges: judges
            .filter((j) => j.schoolOrganizationId === schoolId)
            .map((j) => ({
              id: j.id,
              name: f.people.find((p) => p.actorId === j.actorId)!.name,
              slots: slots.map((s) => judgeSlot(j, s.id)),
              clearedFor: f.clearances.some((c) => c.tournamentJudgeId === j.id)
                ? f.clearances
                    .filter((c) => c.tournamentJudgeId === j.id)
                    .map((c) => c.eventId)
                : f.events.map((e) => e.id),
              judgedCount: new Set(
                f.submitted
                  .filter((b) => b.actorId === j.actorId)
                  .map((b) => b.roundId),
              ).size,
              strikes: f.strikes
                .filter((s) => s.tournamentJudgeId === j.id)
                .map((s) => ({
                  source: s.source,
                  entryName: f.entries.find((e) => e.id === s.entryId)!.name,
                })),
              declaredConflict: null,
            })),
        }),
      ),
      notShown: null,
      capabilities: { manageJudges: manage },
    },
  });
}
export const readHostRoster =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostRoster'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId?: string | undefined },
  ): Promise<HostRosterView | null> => {
    if (!idSchema.safeParse(input.lobbyId).success) return null;
    return dependencies.store.hostRoster(
      { viewerUserId: principal.userId, lobbyId: input.lobbyId },
      async (f) => {
        if (
          !f ||
          !dependencies.authorize({
            principal,
            resource: hostLobbyResource(
              f.lobby,
              f.authorization.organization,
              f.ownerActorId,
            ),
            context: {
              account: f.authorization.account,
              grants: f.authorization.grants,
              now: f.checkedAt,
            },
            capability: 'lobby.host.entries.read',
          }).allow
        )
          return null;
        const eventId = input.eventId ?? f.events[0]?.id ?? null;
        if (eventId !== null && !f.events.some((e) => e.id === eventId))
          return null;
        return project(
          f,
          eventId,
          dependencies.authorize({
            principal,
            resource: hostLobbyResource(
              f.lobby,
              f.authorization.organization,
              f.ownerActorId,
            ),
            context: {
              account: f.authorization.account,
              grants: f.authorization.grants,
              now: f.checkedAt,
            },
            capability: 'tournament.entries.manage',
          }).allow,
        );
      },
    );
  };
