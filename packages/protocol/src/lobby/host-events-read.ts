import { z } from 'zod';
import { idSchema } from '../primitives';
import { tournamentSetupViewSchema } from './lobby-setup-read';
import {
  eventPinSchema,
  tabRoundResolutionSchema,
} from './lobby-setup-command';
import type { LobbyReadCatalogue } from './read';
export const eventPinOptionSchema = z.strictObject({
  key: z.string().min(1).max(256),
  label: z.string().min(1).max(600),
  pin: eventPinSchema,
});
export const eventResolutionChoiceSchema = z.strictObject({
  key: z.string().min(1).max(256),
  label: z.string().min(1).max(600),
  resolution: tabRoundResolutionSchema.unwrap(),
  wording: z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('shown'),
        text: z.string().trim().min(1).max(300),
      }),
      z.strictObject({
        kind: z.literal('withheld'),
        addedAt: z.iso.datetime(),
      }),
    ])
    .nullable(),
});
export const hostEventsViewSchema = z.strictObject({
  setup: tournamentSetupViewSchema,
  lobbyVersion: z.int().positive(),
  timeSlotVersions: z.array(
    z.strictObject({ timeSlotId: idSchema, version: z.int().positive() }),
  ),
  pinOptions: z.array(eventPinOptionSchema),
  resolutionChoices: z.array(eventResolutionChoiceSchema),
});
export type HostEventsView = z.infer<typeof hostEventsViewSchema>;
export const hostEventsReadCatalogue = {
  HostEventsView: { gate: ['lobby.setup.manage'] },
} as const satisfies LobbyReadCatalogue<'HostEventsView'>;
