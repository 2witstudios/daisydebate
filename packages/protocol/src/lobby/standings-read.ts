import { z } from 'zod';
import { idSchema } from '../primitives';
import { standingsMetricSchema } from '../settings/setting-values';
import type { LobbyReadCatalogue } from './read';
import { responsibleKinds } from './vocabulary';

/**
 * An event's standings and its elimination bracket (TAB-5.13, TAB-5.14).
 * Standings are computed each time they are read, never stored. An official
 * reads them from every result; anyone else from the results released to
 * their audiences, with speaker points only where scores have been released
 * to them. A bracket shows a result only once its decision is released to
 * the viewer.
 */

const name = z.string().trim().min(1).max(200);
/** Words the standings computation wrote; a projection shows them as they are. */
const text = z.string().trim().min(1).max(2000);
const count = z.int().min(0);
const position = z.int().min(1);
const instant = z.iso.datetime();

const rowShape = {
  seed: position,
  entry: z.strictObject({ entryId: idSchema, name }),
  /** Who answers for the entry: its school, its guardian's family, or the entrant. */
  responsible: z.strictObject({ kind: z.enum(responsibleKinds), name }),
  wins: count,
  opponentWins: count,
  /** The entry's rating at the start of the event; null when unrated. */
  rating: z.int().nullable(),
  /** Which tiebreak placed the entry on this line, as the computation put it. */
  explanation: text,
  /** Whether that tiebreak decided the break line. */
  decidesBreak: z.boolean(),
};
const rowWithPoints = z.strictObject({
  ...rowShape,
  points: z.number().min(0),
});
const rowWithoutPoints = z.strictObject(rowShape);

const standingsShape = {
  lobbyId: idSchema,
  eventId: idSchema,
  division: name.nullable(),
  /** The last tab round whose results the table counts. */
  throughRound: position,
  progress: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('running'), tabRoundNumber: position }),
    z.strictObject({ kind: z.literal('complete'), ballots: count }),
  ]),
  /** The resolved `standings.tiebreaks` order. */
  tiebreaks: z.array(standingsMetricSchema).min(1),
  /** The break line and the tab round it breaks to; null before one is set. */
  breakLine: z.strictObject({ seeds: position, tabRoundName: name }).nullable(),
  breakAnnouncedAt: instant.nullable(),
  /** Every entry on the table; `rows` are its top lines. */
  entryCount: count,
};

export const standingsViewSchema = z.discriminatedUnion('visibility', [
  /** An official: every result, whatever has been released. */
  z.strictObject({
    ...standingsShape,
    visibility: z.literal('official'),
    rows: z.array(rowWithPoints),
    capabilities: z.strictObject({
      announceBreak: z.boolean(),
      previewCorrection: z.boolean(),
    }),
  }),
  /** Released decisions and released scores. */
  z.strictObject({
    ...standingsShape,
    visibility: z.literal('released_with_scores'),
    rows: z.array(rowWithPoints),
  }),
  /** Released decisions only: no speaker points. */
  z.strictObject({
    ...standingsShape,
    visibility: z.literal('released_decisions'),
    rows: z.array(rowWithoutPoints),
  }),
]);
export type StandingsView = z.infer<typeof standingsViewSchema>;

const side = z.strictObject({ entryId: idSchema, seed: position, name });
const roomRef = z.strictObject({ roomId: idSchema, name });

const decided = z.strictObject({
  kind: z.literal('decided'),
  topBallots: count,
  bottomBallots: count,
});
const live = z.strictObject({
  kind: z.literal('live'),
  room: roomRef,
  /** Whether the viewer may watch it: video released to them, or an official. */
  watchable: z.boolean(),
});
const scheduled = z.strictObject({ kind: z.literal('scheduled') });
/** Decided, but the decision is not released to the viewer's audiences. */
const withheld = z.strictObject({ kind: z.literal('withheld') });

const tieShape = { fixtureId: idSchema, top: side, bottom: side };
const officialTie = z.strictObject({
  ...tieShape,
  state: z.discriminatedUnion('kind', [decided, live, scheduled]),
});
const audienceTie = z.strictObject({
  ...tieShape,
  state: z.discriminatedUnion('kind', [decided, live, scheduled, withheld]),
});

const tabRoundShape = {
  tabRoundId: idSchema,
  name,
  status: z.enum(['complete', 'running', 'scheduled']),
  startsAt: instant.nullable(),
  /** For a tab round not yet drawn: what its draw waits on. */
  waitsOn: z
    .strictObject({
      feederTabRoundName: name,
      ballotsNeeded: position,
      panelSize: position,
    })
    .nullable(),
};

const bracketShape = {
  lobbyId: idSchema,
  eventId: idSchema,
  stageId: idSchema,
  division: name.nullable(),
};

export const bracketViewSchema = z.discriminatedUnion('visibility', [
  z.strictObject({
    ...bracketShape,
    visibility: z.literal('official'),
    tabRounds: z.array(
      z.strictObject({ ...tabRoundShape, ties: z.array(officialTie) }),
    ),
  }),
  z.strictObject({
    ...bracketShape,
    visibility: z.literal('audience'),
    tabRounds: z.array(
      z.strictObject({ ...tabRoundShape, ties: z.array(audienceTie) }),
    ),
  }),
]);
export type BracketView = z.infer<typeof bracketViewSchema>;
export type BracketTie = z.infer<typeof audienceTie>;

export const standingsReadCatalogue = {
  StandingsView: { gate: ['standings.read'] },
  BracketView: { gate: ['standings.read'] },
} as const satisfies LobbyReadCatalogue<'StandingsView' | 'BracketView'>;
