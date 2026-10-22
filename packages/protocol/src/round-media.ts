import { z } from 'zod';
import { idSchema } from './primitives';

export const roundMediaGrantsSchema = z.strictObject({
  publish: z
    .array(z.enum(['camera', 'microphone']))
    .max(2)
    .refine((sources) => new Set(sources).size === sources.length),
  subscribe: z.boolean(),
  hidden: z.boolean(),
  capture: z.literal(false),
});

/** Private to the authenticated viewer. Hidden judge identities never enter peers. */
export const roundMediaStateSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  state: z.enum(['ready', 'ended', 'unavailable']),
  grants: roundMediaGrantsSchema,
  peers: z.array(
    z.strictObject({
      participantId: idSchema,
      identity: idSchema,
      microphone: z.boolean(),
    }),
  ),
});
export const roundMediaAdmissionSchema = roundMediaStateSchema.safeExtend({
  state: z.literal('ready'),
  identity: idSchema,
  url: z.url({ protocol: /^wss$/ }).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
  token: z.string().min(1).max(16384),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type RoundMediaState = z.infer<typeof roundMediaStateSchema>;
export type RoundMediaAdmission = z.infer<typeof roundMediaAdmissionSchema>;
