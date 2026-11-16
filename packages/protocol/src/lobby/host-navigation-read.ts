import { z } from 'zod';
import { authorizationCapabilitySchema } from '../authorization';
import { idSchema } from '../primitives';
import { hostAreaCapabilities } from '../capability-metadata';

/** The shell's evaluated areas and nonprivate addressing metadata, never area contents. */
export const hostNavigationViewSchema = z.strictObject({
  kind: z.enum(['organization', 'lobby']),
  id: idSchema,
  handle: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  areas: z
    .array(authorizationCapabilitySchema)
    .refine((areas) =>
      areas.every((area) => hostAreaCapabilities.includes(area)),
    ),
  manageSetup: z.boolean(),
  events: z.array(
    z.strictObject({ eventId: idSchema, name: z.string().min(1).max(200) }),
  ),
});
export type HostNavigationView = z.infer<typeof hostNavigationViewSchema>;
