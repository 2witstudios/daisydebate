import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { commandAction } from './action';
import type { tournamentPageSchema } from './participant-page-read';

export const entryFormContextSchema = z.strictObject({
  lobbyId: idSchema,
  handle: z.string().regex(/^[a-z0-9-]{1,64}$/),
  actorId: idSchema,
  eventId: idSchema,
  commandId: idSchema,
  expected: z.int().positive(),
});
export type EntryFormContext = z.infer<typeof entryFormContextSchema>;

export function participantEntriesOf(
  tournament: z.infer<typeof tournamentPageSchema>,
  nextId: () => string,
) {
  const {
    id: lobbyId,
    name,
    handle,
    actorId,
    entries,
    schedule,
    registration,
  } = tournament;
  return {
    name,
    handle,
    entries: entries.map((entry) => ({
      ...entry,
      event: schedule.find((row) => row.eventId === entry.eventId)?.event,
    })),
    registration: registration.map(
      ({ eventId, name, expected, divisions }) => ({
        eventId,
        name,
        divisions,
        action: commandAction<EntryFormContext>(
          'Enter event',
          { lobbyId, handle, actorId, eventId, expected, commandId: nextId() },
          true,
        ),
      }),
    ),
  };
}
