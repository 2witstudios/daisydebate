import { z } from 'zod';
import { idSchema } from '../primitives';
import { settingValueSchemas } from '../settings/setting-values';
import type { LobbyReadCatalogue } from './read';

/**
 * The reads of resolutions: an event's pool and rules for its host
 * (TAB-5.13), and one tab round's resolution for a participant (TAB-5.14).
 * An unreleased resolution's text is carried only to a viewer holding
 * `tournament.resolutions.read_unreleased`; anyone else gets `withheld`.
 */

const nameSchema = z.string().trim().min(1).max(200);
const resolutionTextSchema = z.string().trim().min(1).max(500);

/** A resolution's text, or its absence for a viewer the text is not released to. */
const resolutionTextVariantSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('shown'), text: resolutionTextSchema }),
  z.strictObject({ kind: z.literal('withheld') }),
]);

const tabRoundRefSchema = z.strictObject({
  id: idSchema,
  number: z.int().min(1),
  name: nameSchema.nullable(),
});

const poolResolutionSchema = z
  .strictObject({
    id: idSchema,
    origin: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('pool'), poolName: nameSchema }),
      z.strictObject({
        kind: z.literal('lobby'),
        addedBy: z.strictObject({
          name: nameSchema,
          roleName: nameSchema.nullable(),
        }),
      }),
    ]),
    /** Held back from every draw for one tab round until it is released. */
    hold: z
      .strictObject({ tabRoundName: nameSchema, released: z.boolean() })
      .nullable(),
    text: resolutionTextVariantSchema,
  })
  .refine(
    (resolution) =>
      resolution.text.kind === 'shown' ||
      (resolution.hold !== null && !resolution.hold.released),
    { message: 'only an unreleased resolution is withheld', path: ['text'] },
  );
export type PoolResolution = z.infer<typeof poolResolutionSchema>;

/** The tab rounds that share one resolution rule, and whether it may still change. */
const roundRuleSchema = z.strictObject({
  tabRounds: z.array(tabRoundRefSchema).min(1),
  rule: settingValueSchemas['resolution.rule'],
  /** False once the rounds have used their resolutions. */
  changeable: z.boolean(),
  /** How long before the round a resolution given to all is released. */
  releaseLeadMs: z.int().min(0).nullable(),
});
export type RoundResolutionRule = z.infer<typeof roundRuleSchema>;

/** An event's resolution pool and per-round rules, for its host. */
export const resolutionPoolViewSchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  counts: z.strictObject({
    fromPool: z.int().min(0),
    addedHere: z.int().min(0),
  }),
  /** A strike rule the pool is too small for. */
  shortfall: z
    .strictObject({ drawSize: z.int().min(1), needed: z.int().min(1) })
    .nullable(),
  /** The first resolutions of the pool; the counts count them all. */
  resolutions: z.array(poolResolutionSchema),
  rules: z.array(roundRuleSchema),
  /** Resolutions set for a tab round and not yet released. */
  unreleased: z.array(
    z.strictObject({
      tabRound: tabRoundRefSchema,
      text: resolutionTextVariantSchema,
      releasesAt: z.iso.datetime(),
      /** The roles besides the host who may read it before then. */
      readerRoles: z.array(nameSchema),
    }),
  ),
  capabilities: z.strictObject({ edit: z.boolean(), release: z.boolean() }),
});
export type ResolutionPoolView = z.infer<typeof resolutionPoolViewSchema>;

/** One tab round's resolution as a participant sees it. */
export const roundResolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('released'), text: resolutionTextSchema }),
  /** The candidates the Room strikes from, once they are drawn. */
  z.strictObject({
    kind: z.literal('strike'),
    candidates: z
      .array(z.strictObject({ id: idSchema, text: resolutionTextSchema }))
      .min(2),
  }),
  z.strictObject({ kind: z.literal('not_released') }),
]);
export type RoundResolution = z.infer<typeof roundResolutionSchema>;

export const resolutionViewSchema = z.strictObject({
  tabRoundId: idSchema,
  resolution: roundResolutionSchema,
});
export type ResolutionView = z.infer<typeof resolutionViewSchema>;

export const resolutionReadCatalogue = {
  ResolutionPoolView: { gate: ['lobby.host.read'] },
  ResolutionView: { gate: ['resolution.read'] },
} as const satisfies LobbyReadCatalogue<
  'ResolutionPoolView' | 'ResolutionView'
>;
