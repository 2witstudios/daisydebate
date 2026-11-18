import { z } from 'zod';
import { idSchema, ratingLadders } from './primitives';

/**
 * A league request (PYL-17): someone who runs a league asks Daisy to set one
 * up with them. League is sales-led ("Talk to us", decision 80), so the
 * request is what the owner reads before replying, not a purchase. These are
 * the request's closed vocabularies, shared by the form, its route and the
 * table's CHECKs.
 */
export const leagueRequestSchoolCounts = [
  'under-10',
  '10-25',
  '26-50',
  'over-50',
] as const;
export type LeagueRequestSchoolCount =
  (typeof leagueRequestSchoolCounts)[number];

export const leagueRequestSeasonCounts = ['1', '2', '3-plus'] as const;
export type LeagueRequestSeasonCount =
  (typeof leagueRequestSeasonCounts)[number];

/**
 * The divisions the league wants to run. A wish for the conversation: the
 * league the owner then sets up carries exactly one division.
 */
export const leagueRequestDivisions = [
  'youth',
  'open',
  'youth-and-open',
] as const;
export type LeagueRequestDivisions = (typeof leagueRequestDivisions)[number];

/** Freestyle is the only style a league can run today (ADR 0142). */
export const leagueRequestStyles = ratingLadders;

/** The longest value each free-text field holds. */
export const leagueRequestLimits = {
  leagueName: 120,
  contactName: 120,
  contactRole: 120,
  contactEmail: 320,
  contactPhone: 32,
  needs: 4000,
} as const;

/**
 * One line of text: no control characters, so a name can never break the
 * owner email's subject or a header.
 */
const required = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u);

/** Digits, spaces and the usual phone punctuation, with at least seven digits. */
const phoneSchema = z
  .string()
  .trim()
  .max(leagueRequestLimits.contactPhone)
  .regex(/^\+?[\d\s().-]*$/)
  .refine((value) => value.replace(/\D/g, '').length >= 7);

/** The request's body, version 1: what the form sends and the route stores. */
export const leagueRequestSchema = z.strictObject({
  v: z.literal(1),
  /** Chosen when the form is shown, so sending it again stores it once. */
  requestId: idSchema,
  leagueName: required(leagueRequestLimits.leagueName),
  schools: z.enum(leagueRequestSchoolCounts),
  seasons: z.enum(leagueRequestSeasonCounts),
  style: z.enum(leagueRequestStyles),
  divisions: z.enum(leagueRequestDivisions),
  needs: z.string().trim().max(leagueRequestLimits.needs),
  contactName: required(leagueRequestLimits.contactName),
  contactRole: required(leagueRequestLimits.contactRole),
  contactEmail: z
    .string()
    .trim()
    .max(leagueRequestLimits.contactEmail)
    .pipe(z.email()),
  /** Empty when the contact gave none. */
  contactPhone: z
    .string()
    .trim()
    .pipe(z.union([z.literal(''), phoneSchema])),
});
export type LeagueRequest = z.infer<typeof leagueRequestSchema>;

/** The route's answer. Nothing in it says whether the request was stored. */
export const leagueRequestResultSchema = z.strictObject({
  received: z.literal(true),
});
