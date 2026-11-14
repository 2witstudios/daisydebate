import { z } from 'zod';
import { idSchema } from '../primitives';
import { releaseAudienceSchema } from '../release-audience';
import { roundResolutionSchema } from './resolution-read';
import type { LobbyReadCatalogue } from './read';

/**
 * The reads of ballots: an event's ballot definition for its host
 * (TAB-5.13), a judge's own ballot, and a submitted ballot for anyone else
 * (TAB-5.14). A submitted ballot carries one variant for an official, who
 * sees every part and the judge's original text, and one for an audience,
 * which sees only the parts released to it and screened text.
 */

const nameSchema = z.string().trim().min(1).max(200);
const writtenRuleSchema = z.enum(['required', 'optional', 'off']);
const writtenTextSchema = z.string().max(5000);

/** The typed settings of one immutable ballot definition version. */
export const ballotDefinitionSchema = z.strictObject({
  version: z.int().min(1),
  points: z
    .strictObject({
      min: z.number(),
      max: z.number(),
      step: z.number().positive(),
      lowPointWin: z.boolean(),
    })
    .refine((points) => points.min < points.max, {
      message: 'the scale runs upward',
      path: ['max'],
    })
    .nullable(),
  ranks: z.boolean(),
  criteria: z.array(nameSchema),
  outcomes: z.strictObject({ winner: z.boolean(), doubleLoss: z.boolean() }),
  written: z.strictObject({
    reason: writtenRuleSchema,
    feedback: writtenRuleSchema,
    /** Never required: a judge may have nothing to tell tab. */
    privateNote: writtenRuleSchema.exclude(['required']),
  }),
});
export type BallotDefinitionValue = z.infer<typeof ballotDefinitionSchema>;

/** An event's ballot definition and its screening, for its host. */
export const eventBallotViewSchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  definition: ballotDefinitionSchema,
  /** Where the definition is pinned: by the template the event follows, or by the event. */
  pin: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('template'),
      templateId: idSchema,
      organizationName: nameSchema,
    }),
    z.strictObject({ kind: z.literal('event') }),
  ]),
  /** The tab rounds that have used this version, by number. */
  usedIn: z
    .strictObject({ first: z.int().min(1), last: z.int().min(1) })
    .nullable(),
  /** The resolved `ballot.screening` value. */
  screening: z.enum(['hold', 'off']),
  capabilities: z.strictObject({ setScreening: z.boolean() }),
});
export type EventBallotView = z.infer<typeof eventBallotViewSchema>;

/** Who a judge scores, keyed as the ballot keys its scores. */
const ballotSubjectSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]{1,24}$/),
  name: nameSchema,
  /** A side's name, or a speaker's school. */
  role: nameSchema.nullable(),
});
export type BallotSubjectValue = z.infer<typeof ballotSubjectSchema>;

/** One judge's own ballot for one fixture, before it is submitted. */
export const judgeBallotViewSchema = z.strictObject({
  fixtureId: idSchema,
  tournamentName: nameSchema,
  /** Named where the tournament runs several events of the judge's kind. */
  eventName: nameSchema.nullable(),
  tabRoundName: nameSchema,
  /** The fixture's Room or section, by name. */
  placeName: nameSchema,
  panel: z.strictObject({
    size: z.int().min(1),
    position: z.int().min(1),
    chair: z.boolean(),
  }),
  resolution: roundResolutionSchema,
  definition: ballotDefinitionSchema,
  subjectKind: z.enum(['debater', 'speaker', 'team']),
  subjects: z.array(ballotSubjectSchema).min(1),
  draft: z.strictObject({
    winner: ballotSubjectSchema.shape.key.nullable(),
    points: z.record(z.string(), z.number()),
    reason: writtenTextSchema,
  }),
  /** The audiences the event's `audience.reason` opens the reason to. */
  reasonAudiences: z.array(releaseAudienceSchema),
});
export type JudgeBallotView = z.infer<typeof judgeBallotViewSchema>;

/** A part of a submitted ballot an audience may or may not have been released. */
const releasedPart = <Value extends z.ZodType>(value: Value) =>
  z.discriminatedUnion('open', [
    z.strictObject({ open: z.literal(false) }),
    z.strictObject({ open: z.literal(true), value }),
  ]);

/** Written text an audience reads: screened, or held back by screening. */
const screenedTextSchema = z.discriminatedUnion('screening', [
  z.strictObject({ screening: z.literal('clear'), text: writtenTextSchema }),
  z.strictObject({ screening: z.literal('held') }),
]);

const scoresSchema = z.record(z.string(), z.number());

/** A submitted ballot, as an official or an audience sees it. */
export const ballotViewSchema = z.discriminatedUnion('viewer', [
  /** Every part, and the judge's original text whatever screening held. */
  z.strictObject({
    viewer: z.literal('official'),
    ballotId: idSchema,
    fixtureId: idSchema,
    judgeName: nameSchema,
    decision: ballotSubjectSchema.shape.key.nullable(),
    scores: scoresSchema,
    reason: writtenTextSchema,
    feedback: z.record(z.string(), writtenTextSchema),
  }),
  /** Only the parts released to one of the viewer's audiences, text screened. */
  z.strictObject({
    viewer: z.literal('audience'),
    ballotId: idSchema,
    fixtureId: idSchema,
    judgeName: nameSchema,
    decision: releasedPart(ballotSubjectSchema.shape.key.nullable()),
    scores: releasedPart(scoresSchema),
    reason: releasedPart(screenedTextSchema),
    feedback: releasedPart(z.record(z.string(), screenedTextSchema)),
  }),
]);
export type BallotView = z.infer<typeof ballotViewSchema>;

export const ballotReadCatalogue = {
  EventBallotView: { gate: ['lobby.host.read'] },
  JudgeBallotView: { gate: ['ballot.read'] },
  BallotView: { gate: ['ballot.read'] },
} as const satisfies LobbyReadCatalogue<
  'EventBallotView' | 'JudgeBallotView' | 'BallotView'
>;
