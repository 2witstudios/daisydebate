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
export type LeagueSeasonRead = {
  readonly view: SeasonView;
  readonly formula: SeasonFormula | null;
  readonly series: readonly { readonly id: string; readonly name: string }[];
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
): LeagueSeasonRead | null {
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
      calendar: facts.calendar
        .filter((row) => row.sanction.templateId === template.id)
        .map((row) => ({
          lobbyId: row.lobby.id,
          handle: row.lobby.handle,
          name: row.lobby.name,
          when: { precision: 'day', startsAt: row.startsAt.toISOString() },
          completed: events.some(
            (event) =>
              event.competition.configuration.lobby.id === row.lobby.id &&
              event.certifiedAt !== null,
          ),
          sanction: row.sanction.status,
        })),
      standings: {
        series: { templateId: template.id, name: template.name },
        certifiedCount: events.filter((event) => event.certifiedAt !== null)
          .length,
        awaitingCertification: events
          .filter((event) => event.certifiedAt === null)
          .map((event) => ({
            lobbyId: event.competition.configuration.lobby.id,
            name: event.competition.configuration.lobby.name,
          })),
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
        return projectLeagueSeason(facts, principal.actorId, input.templateId);
      },
    );
