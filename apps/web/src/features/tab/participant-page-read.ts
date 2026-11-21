import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import {
  entryStatuses,
  fixtureKinds,
  tournamentStatuses,
} from '@daisy/protocol/lobby';
import {
  bracketViewSchema,
  standingsViewSchema,
} from '@daisy/protocol/lobby/standings-read';

const handle = z.string().regex(/^[a-z0-9-]{1,64}$/i);
const section = z.enum(['standings', 'bracket']);
export const participantPageQuery = z.discriminatedUnion('view', [
  z.strictObject({
    view: z.literal('directory'),
    after: z.union([z.literal(''), idSchema]).default(''),
  }),
  z.strictObject({ view: z.literal('tournament'), handle }),
  z.strictObject({
    view: z.literal('posting'),
    handle,
    eventId: idSchema,
    roundId: idSchema,
  }),
  z.strictObject({
    view: z.literal('results'),
    handle,
    eventId: idSchema,
    section,
  }),
]);
type PageQuery = z.output<typeof participantPageQuery>;

export function participantPagePath(query: PageQuery) {
  return `/api/tab/participant?${new URLSearchParams(query)}`;
}

const name = z.string().min(1);
const address = { handle, name };
const scheduleRow = z.object({
  eventId: idSchema,
  event: name,
  roundId: idSchema.nullable(),
  round: name.nullable(),
  number: z.int().positive().nullable(),
  startsAt: z.iso.datetime().nullable(),
  posted: z.boolean(),
});
const fixture = z.object({
  fixtureId: idSchema,
  roomId: idSchema.nullable(),
  roomName: name.nullable(),
  kind: z.enum(fixtureKinds),
  live: z.boolean(),
  watchable: z.boolean(),
  waiting: z.boolean(),
  ballotDue: z.boolean(),
  own: z.boolean(),
  judges: z.array(name),
  entries: z.array(name),
});

export const directoryPageSchema = z.object({
  rows: z.array(z.object({ ...address, status: z.enum(tournamentStatuses) })),
  next: idSchema.nullable(),
});
export const tournamentPageSchema = z.object({
  ...address,
  id: idSchema,
  actorId: idSchema,
  status: z.enum(tournamentStatuses),
  host: z.boolean(),
  entries: z.array(
    z.object({
      entryId: idSchema,
      eventId: idSchema,
      name,
      status: z.enum(entryStatuses),
    }),
  ),
  registration: z.array(
    z.object({
      eventId: idSchema,
      name,
      expected: z.int().positive(),
      divisions: z.array(z.object({ key: z.string(), label: name })),
    }),
  ),
  schedule: z.array(scheduleRow),
  ownRooms: z.array(fixture.extend({ round: scheduleRow })),
});
export const postingPageSchema = z.object({
  ...address,
  tournamentReadable: z.boolean(),
  selected: z.object({
    round: name.nullable(),
    number: z.int().positive().nullable(),
    event: name,
    resolution: name.nullable(),
    fixtures: z.array(fixture),
  }),
});
const resultAddress = {
  name,
  tournamentReadable: z.boolean(),
  events: z.array(z.object({ id: idSchema, label: name })),
};
export const resultsPageSchema = z.discriminatedUnion('kind', [
  z.object({
    ...resultAddress,
    kind: z.literal('standings'),
    standings: standingsViewSchema.nullable(),
  }),
  z.object({
    ...resultAddress,
    kind: z.literal('bracket'),
    brackets: z.array(bracketViewSchema),
  }),
]);
