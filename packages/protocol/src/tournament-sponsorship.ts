import { z } from 'zod';
import { idSchema } from './primitives';
import { historyAuthoritySchema } from './lobby/command';

const common = {
  id: idSchema,
  lobbyId: idSchema,
  version: z.number().int().positive(),
  sponsorUserId: idSchema,
  actedByUserId: idSchema,
  authority: historyAuthoritySchema,
  actedAt: z.iso.datetime(),
};
/** Each accepted version names the organization's exact proposal and the consenting account's source. */
export const tournamentSponsorshipVersionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('proposed'),
    previousVersionId: idSchema.nullable(),
  }),
  z
    .strictObject({
      ...common,
      kind: z.literal('active'),
      previousVersionId: idSchema,
      hostingVersionId: idSchema,
    })
    .refine((v) => v.actedByUserId === v.sponsorUserId),
  z.strictObject({
    ...common,
    kind: z.literal('revoked'),
    previousVersionId: idSchema,
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type TournamentSponsorshipVersion = z.infer<
  typeof tournamentSponsorshipVersionSchema
>;

type WithoutAuthority<Value> = Value extends unknown
  ? Omit<Value, 'authority'>
  : never;
export type TournamentSponsorshipChange =
  WithoutAuthority<TournamentSponsorshipVersion>;
