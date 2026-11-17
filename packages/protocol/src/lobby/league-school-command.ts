import { z } from 'zod';
import { idSchema } from '../primitives';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

export const leagueSchoolStatuses = ['invited', 'active', 'ended'] as const;
export type LeagueSchoolStatus = (typeof leagueSchoolStatuses)[number];
const pair = { leagueId: idSchema, schoolId: idSchema } as const;
/** The league invites; the school assents. Either controller can explicitly end the relation. */
export const leagueSchoolCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('invite-league-school'), ...pair }),
  z.strictObject({ type: z.literal('accept-league-school'), ...pair }),
  z.strictObject({
    type: z.literal('end-league-school'),
    ...pair,
    side: z.enum(['league', 'school']),
  }),
]);
export type LeagueSchoolCommand = z.infer<typeof leagueSchoolCommandSchema>;
export const leagueSchoolCommandEnvelopeSchema = lobbyCommandEnvelope(
  leagueSchoolCommandSchema,
);
export type LeagueSchoolRefusal =
  | 'already-invited'
  | 'already-member'
  | 'invitation-closed'
  | 'membership-ended'
  | 'wrong-organization-kind';
const definition = {
  aggregate: 'league_school',
  gate: ['organization.manage'],
  history: 'entry',
} as const;
export const leagueSchoolCommandCatalogue = {
  'invite-league-school': {
    ...definition,
    versions: ['organization'],
    refusals: ['already-invited', 'already-member', 'wrong-organization-kind'],
  },
  'accept-league-school': {
    ...definition,
    versions: ['membership'],
    refusals: ['invitation-closed', 'wrong-organization-kind'],
  },
  'end-league-school': {
    ...definition,
    versions: ['membership'],
    refusals: ['membership-ended', 'wrong-organization-kind'],
  },
} as const satisfies LobbyCommandCatalogue<LeagueSchoolCommand>;

/** One evaluator target per command, never authority inferred from the other organization. */
export const leagueSchoolController = (command: LeagueSchoolCommand): string =>
  command.type === 'accept-league-school' ||
  (command.type === 'end-league-school' && command.side === 'school')
    ? command.schoolId
    : command.leagueId;
