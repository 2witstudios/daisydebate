import { z } from 'zod';
import { idSchema } from '../primitives';
import { permissions } from './vocabulary';
import type { LobbyReadCatalogue } from './read';

/** Lobby grant recipients and ownership, independent of organization membership. */
export const lobbyPeopleViewSchema = z
  .strictObject({
    lobbyId: idSchema,
    version: z.int().positive(),
    name: z.string().min(1),
    people: z.array(
      z.strictObject({
        userId: idSchema,
        name: z.string().min(1),
        owner: z.boolean(),
        grants: z.array(
          z.strictObject({
            grantId: idSchema,
            roleId: idSchema,
            expiresAt: z.iso.datetime().nullable(),
            removable: z.boolean(),
          }),
        ),
        removable: z.boolean(),
      }),
    ),
    roles: z.array(
      z.strictObject({
        roleId: idSchema,
        name: z.string().min(1),
        rank: z.int().min(0),
        preset: z.boolean(),
        permissions: z.array(z.enum(permissions)),
        giveable: z.boolean(),
      }),
    ),
    capabilities: z.strictObject({ give: z.boolean() }),
  })
  .refine(
    (view) =>
      view.people.every(
        (person) =>
          !person.owner ||
          (!person.removable &&
            person.grants.every((grant) => !grant.removable)),
      ),
    { message: 'The owner is never removable.', path: ['people'] },
  );
export type LobbyPeopleView = z.infer<typeof lobbyPeopleViewSchema>;
export const lobbyPeopleReadCatalogue = {
  LobbyPeopleView: { gate: ['lobby.host.people.read'] },
} as const satisfies LobbyReadCatalogue<'LobbyPeopleView'>;
