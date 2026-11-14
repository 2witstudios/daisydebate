import { z } from 'zod';
import { idSchema } from '../primitives';
import { settingKeySchema } from '../settings/setting-values';
import type { LobbyReadCatalogue } from './read';
import { sanctionStatuses, seasonCountings } from './vocabulary';

const name = z.string().trim().min(1).max(200);
const handle = z.string().trim().min(1).max(64);
const count = z.int().min(0);
const instant = z.iso.datetime();

/**
 * When a season's tournament is: a day, or only the month while its day is
 * not fixed.
 */
export const seasonDateSchema = z.discriminatedUnion('precision', [
  z.strictObject({ precision: z.literal('day'), startsAt: instant }),
  z.strictObject({
    precision: z.literal('month'),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  }),
]);
export type SeasonDate = z.infer<typeof seasonDateSchema>;

/** A tournament on a league's season calendar and how it stands with the season. */
export const seasonTournamentSchema = z.strictObject({
  lobbyId: idSchema,
  handle,
  name,
  when: seasonDateSchema,
  completed: z.boolean(),
  /** Its sanction by the league, or null where the season counts by membership. */
  sanction: z.enum(sanctionStatuses).nullable(),
});
export type SeasonTournament = z.infer<typeof seasonTournamentSchema>;

export const seasonStandingRowSchema = z.strictObject({
  place: z.int().min(1),
  entrant: name,
  school: name,
  points: count,
  /** The viewer's own line. */
  viewer: z.boolean(),
});

/**
 * A league's season: its calendar of tournaments, and the computed season
 * standings of one series (the events that follow one template), from the
 * certified tournaments only; those awaiting certification are named.
 */
export const seasonViewSchema = z.strictObject({
  seasonId: idSchema,
  name,
  organization: z.strictObject({ organizationId: idSchema, name }),
  counting: z.enum(seasonCountings),
  calendar: z.array(seasonTournamentSchema),
  standings: z.strictObject({
    series: z.strictObject({ templateId: idSchema, name }),
    certifiedCount: count,
    awaitingCertification: z.array(z.strictObject({ lobbyId: idSchema, name })),
    rows: z.array(seasonStandingRowSchema),
  }),
});
export type SeasonView = z.infer<typeof seasonViewSchema>;

/**
 * One sanction: the event asking to count, the tournament and organization
 * that host it, the season and template, its state, and the computed check
 * (`follows`: the event follows the template, which always passes;
 * `mismatches`: the enforced keys whose values differ).
 */
export const sanctionSchema = z
  .strictObject({
    sanctionId: idSchema,
    status: z.enum(sanctionStatuses),
    event: z.strictObject({ eventId: idSchema, name }),
    lobby: z.strictObject({ lobbyId: idSchema, name, startsAt: instant }),
    host: z.strictObject({ organizationId: idSchema, name }),
    season: z.strictObject({ seasonId: idSchema, name }),
    template: z.strictObject({ templateId: idSchema, name }),
    follows: z.boolean(),
    mismatches: z.array(settingKeySchema),
  })
  .refine((sanction) => !sanction.follows || sanction.mismatches.length === 0, {
    message: 'An event that follows the template always meets it.',
    path: ['mismatches'],
  });
export type Sanction = z.infer<typeof sanctionSchema>;

export const sanctionListSchema = z.strictObject({
  organizationId: idSchema,
  sanctions: z.array(sanctionSchema),
  capabilities: z.strictObject({ decide: z.boolean() }),
});
export type SanctionList = z.infer<typeof sanctionListSchema>;

export const seasonReadCatalogue = {
  SeasonView: { gate: ['standings.read'] },
  SanctionList: { gate: ['sanction.read'] },
} as const satisfies LobbyReadCatalogue<'SeasonView' | 'SanctionList'>;
