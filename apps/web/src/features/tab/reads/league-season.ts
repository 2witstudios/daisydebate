import { readLeagueRooms, type LeagueRoomsRead } from './league-rooms';
import {
  leagueSeasonExceptions,
  type LeagueSeasonException,
} from './league-exceptions';
import { projectLeagueCalendar } from './league-calendar';
import { z } from 'zod';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import type { TabStore, LeagueSeasonFacts } from '@daisy/db/tab';
import {
  seasonViewSchema,
  type SeasonView,
} from '@daisy/protocol/lobby/season-read';
import { seasonStandings } from '@daisy/tab-engine';
import { eventCompetition } from '../operations/event-competition';
import type { TabPrincipal } from '../tab-principal';

type SeasonEvent = Parameters<typeof seasonStandings>[0][number];
type SeasonFormula = Parameters<typeof seasonStandings>[1];
const count = z.int().nonnegative();
export const seasonFormulaSchema = z.strictObject({
  preliminaryWin: z.strictObject({ points: count, cap: count.nullable() }),
  eliminationRound: z.strictObject({ points: count }),
  bestEvents: z.int().positive().nullable(),
  topPerSchool: z.int().positive().nullable(),
});
export type LeagueSeasonProjection = {
  readonly asOf: string;
  readonly exceptions?: readonly LeagueSeasonException[];
  readonly view: SeasonView;
  readonly formula: SeasonFormula | null;
  readonly series: readonly { readonly id: string; readonly name: string }[];
};
export type LeagueSeasonRead = LeagueSeasonProjection & {
  readonly handle: string;
  readonly standingLobby: {
    readonly id: string;
    readonly handle: string;
    readonly name: string;
  } | null;
  readonly template: {
    readonly name: string;
    readonly formatId: string;
    readonly formatVersion: number;
    readonly ballotDefinitionId: string | null;
    readonly settings: readonly {
      readonly key: string;
      readonly value: unknown;
      readonly hold: 'default' | 'enforced';
    }[];
  };
  readonly rooms: LeagueRoomsRead | null;
  readonly canHost: boolean;
  readonly canManage: boolean;
  readonly requests: readonly {
    readonly sanctionId: string;
    readonly version: number;
    readonly lobbyId: string;
    readonly lobbyName: string;
    readonly eventName: string;
    readonly templateName: string;
  }[];
};
const history = (
  competition: LeagueSeasonFacts['events'][number]['competition'],
  kind: 'preliminary' | 'elimination',
) =>
  eventCompetition(competition, {
    stageIds: competition.stages
      .filter((stage) => stage.kind === kind)
      .map((stage) => stage.id),
    cutoff: Number.MAX_SAFE_INTEGER,
    division: null,
    seed: new Uint8Array(32),
  }).history;
export function projectLeagueSeason(
  facts: LeagueSeasonFacts,
  viewerActorId: string | null,
  templateId?: string,
): LeagueSeasonProjection | null {
  const template =
    facts.series.find((row) => row.id === templateId) ??
    (templateId ? null : facts.series[0]);
  if (!template) return null;
  const parsed = seasonFormulaSchema.safeParse(facts.rule.rule);
  const formula = parsed.success ? parsed.data : null;
  const events = facts.events.filter((row) => row.templateId === template.id);
  const input = events.map(({ competition }) => ({
    event: competition.configuration.event.id,
    sanctioned: true,
    format: eventCompetition(competition, {
      stageIds: [],
      cutoff: 0,
      division: null,
      seed: new Uint8Array(32),
    }).format,
    entries: competition.entries.flatMap((entry) =>
      competition.members
        .filter((member) => member.entryId === entry.id)
        .map((member) => ({
          entry: entry.id,
          competitor: member.actorId,
          school: entry.schoolOrganizationId,
        })),
    ),
    preliminary: history(competition, 'preliminary'),
    elimination: history(competition, 'elimination'),
  })) as SeasonEvent[];
  const folded = formula
    ? seasonStandings(input, formula)
    : { rows: [], exceptions: [] };
  const rows = folded.rows.map((row, index) => ({
    place: index + 1,
    entrant:
      facts.people.find((person) => person.actorId === row.competitor)?.name ??
      row.competitor,
    school:
      facts.schools.find(
        (school) =>
          school.id ===
          input
            .flatMap((event) => event.entries)
            .find((entry) => entry.competitor === row.competitor)?.school,
      )?.name ?? 'Independent',
    points: row.points,
    viewer: row.competitor === viewerActorId,
  }));
  return {
    asOf: facts.now,
    exceptions: leagueSeasonExceptions(folded.exceptions, facts),
    formula,
    series: facts.series.map((row) => ({ id: row.id, name: row.name })),
    view: seasonViewSchema.parse({
      seasonId: facts.season.id,
      name: facts.season.name,
      organization: {
        organizationId: facts.organization.id,
        name: facts.organization.name,
      },
      counting: facts.rule.counting,
      calendar: projectLeagueCalendar(facts, template.id),
      standings: {
        series: { templateId: template.id, name: template.name },
        certifiedCount: new Set(
          events
            .filter((event) => event.certifiedAt !== null)
            .map((event) => event.competition.configuration.lobby.id),
        ).size,
        awaitingCertification: [
          ...new Map([
            ...events
              .filter((event) => event.certifiedAt === null)
              .map(
                (event) =>
                  [
                    event.competition.configuration.lobby.id,
                    {
                      lobbyId: event.competition.configuration.lobby.id,
                      name: event.competition.configuration.lobby.name,
                    },
                  ] as const,
              ),
            // A membership-counted event awaiting certification is known
            // only to the calendar: its results are not read until then.
            ...facts.automaticCalendar
              .filter(
                (row) =>
                  row.templateId === template.id && row.certifiedAt === null,
              )
              .map(
                (row) =>
                  [
                    row.lobby.id,
                    { lobbyId: row.lobby.id, name: row.lobby.name },
                  ] as const,
              ),
          ]).values(),
        ],
        rows,
      },
    }),
  };
}
export const readLeagueSeason =
  (dependencies: {
    readonly store: Pick<TabStore, 'leagueSeason'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: {
      readonly organizationId: string;
      readonly lobbyId?: string;
      readonly seasonId?: string;
      readonly templateId?: string;
    },
  ): Promise<LeagueSeasonRead | null> =>
    dependencies.store.leagueSeason(
      { viewerUserId: principal.userId, ...input },
      async (facts) => {
        if (
          !facts?.authorization.organization ||
          !dependencies.authorize({
            principal,
            resource: facts.authorization.organization,
            context: {
              account: facts.authorization.account,
              grants: facts.authorization.grants,
              now: facts.now,
            },
            capability: 'standings.read',
          }).allow
        )
          return null;
        const projected = projectLeagueSeason(
          facts,
          principal.actorId,
          input.templateId,
        );
        if (!projected) return null;
        const ask = (capability: AuthorizationInput['capability']) =>
          dependencies.authorize({
            principal,
            resource: facts.authorization.organization!,
            context: {
              account: facts.authorization.account,
              grants: facts.authorization.grants,
              now: facts.now,
            },
            capability,
          }).allow;
        const canHost = ask('organization.host.read');
        const canManage = ask('organization.manage');
        return {
          ...projected,
          handle: facts.organization.handle,
          standingLobby: facts.standingLobby
            ? {
                id: facts.standingLobby.id,
                handle: facts.standingLobby.handle,
                name: facts.standingLobby.name,
              }
            : null,
          template: (() => {
            const template = facts.series.find(
              (row) => row.id === projected.view.standings.series.templateId,
            )!;
            return {
              name: template.name,
              formatId: template.formatId,
              formatVersion: template.formatVersion,
              ballotDefinitionId: template.ballotDefinitionId,
              settings: facts.templateSettings
                .filter((row) => row.templateId === template.id)
                .map((row) => ({
                  key: row.key,
                  value: row.value,
                  hold: row.hold,
                })),
            };
          })(),
          rooms: readLeagueRooms(facts, principal, dependencies.authorize),
          canHost,
          canManage,
          requests: canHost
            ? facts.calendar
                .filter((row) => row.sanction.status === 'requested')
                .map((row) => ({
                  sanctionId: row.sanction.id,
                  version: row.sanction.version,
                  lobbyId: row.lobby.id,
                  lobbyName: row.lobby.name,
                  eventName: row.event.name,
                  templateName:
                    facts.series.find(
                      (template) => template.id === row.sanction.templateId,
                    )?.name ?? row.event.name,
                }))
            : [],
        };
      },
    );
