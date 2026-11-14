import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import { audiences, releaseCauses, releaseThings } from './vocabulary';

/**
 * The host's read of an event's results (TAB-5.13): whether it may be
 * certified, which audience each part of a preliminary ballot has opened to,
 * the corrections since prelims were certified, and the sanctioning league.
 * Ballots held by screening are part of the answer only for a viewer who may
 * read unreleased ballots; for anyone else the field is absent.
 */

const name = z.string().trim().min(1).max(200);
/** Words a check wrote; a projection shows them as they are. */
const text = z.string().trim().min(1).max(2000);
const count = z.int().min(0);
const position = z.int().min(1);
const instant = z.iso.datetime();

/** The parts of a ballot: the things a release opens but the posting and video. */
const ballotPart = z.enum(releaseThings).exclude(['posting', 'video']);
export type BallotPart = z.infer<typeof ballotPart>;

/** Where one ballot part stands for one audience across the preliminary rounds. */
const opening = z.strictObject({
  part: ballotPart,
  state: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('open'),
      cause: z.enum(releaseCauses),
      openedAt: instant,
    }),
    /** Its setting is `manual` and every narrower audience is open: it may open now. */
    z.strictObject({ kind: z.literal('openable') }),
  ]),
});

const audienceOpenings = z.strictObject({
  audience: z.enum(audiences),
  /** The parts this audience has, or may now be given; a part it never gets is left out. */
  openings: z.array(opening).min(1),
});

const certification = z.discriminatedUnion('kind', [
  /** Tab rounds still running or still to run. */
  z.strictObject({
    kind: z.literal('blocked'),
    running: z.array(z.strictObject({ tabRoundId: idSchema, name })).min(1),
  }),
  z.strictObject({ kind: z.literal('ready') }),
  z.strictObject({ kind: z.literal('certified'), certifiedAt: instant }),
]);

const personRef = z.strictObject({ actorId: idSchema, name });

/** A correction: a new result superseding one; the draws that used the old one stand. */
const correction = z.strictObject({
  resultId: idSchema,
  supersedesResultId: idSchema,
  tabRoundNumber: position,
  fixture: z.strictObject({
    fixtureId: idSchema,
    entries: z.array(z.strictObject({ entryId: idSchema, name })).min(1),
  }),
  /** What the correction changed. */
  changed: z.enum(['winner', 'points', 'ranks']),
  recordedBy: personRef,
  confirmedBy: personRef.extend({ viewer: z.boolean() }).nullable(),
  recordedAt: instant,
  usedByPublishedDraws: z.array(
    z.strictObject({ drawId: idSchema, tabRoundNumber: position }),
  ),
});

const eventResultsShape = {
  lobbyId: idSchema,
  eventId: idSchema,
  prelimsCertifiedAt: instant.nullable(),
  certification,
  audiences: z.array(audienceOpenings),
  /** Corrections recorded since prelims were certified. */
  corrections: z.array(correction),
  /** The league whose sanction receives the certified results, and when it did. */
  sanction: z
    .strictObject({ organizationName: name, sentAt: instant.nullable() })
    .nullable(),
  capabilities: z.strictObject({ release: z.boolean(), certify: z.boolean() }),
};

export const eventResultsViewSchema = z.discriminatedUnion('ballotAccess', [
  /** A viewer who may read unreleased ballots, so sees what screening holds. */
  z.strictObject({
    ...eventResultsShape,
    ballotAccess: z.literal('unreleased'),
    screeningHolds: z.strictObject({
      count,
      /** What screening found, in its own words. */
      summary: text.nullable(),
    }),
  }),
  z.strictObject({ ...eventResultsShape, ballotAccess: z.literal('released') }),
]);
export type EventResultsView = z.infer<typeof eventResultsViewSchema>;
export type ResultsCorrection = z.infer<typeof correction>;
export type AudienceOpenings = z.infer<typeof audienceOpenings>;

export const resultsReadCatalogue = {
  EventResultsView: { gate: ['lobby.host.read'] },
} as const satisfies LobbyReadCatalogue<'EventResultsView'>;
