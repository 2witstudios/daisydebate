import { z } from 'zod';
import { idSchema } from '../primitives';
import { forceKeys, type ForceKey } from '../settings/force';
import { lobbyCommandEnvelope, type LobbyCommandCatalogue } from './command';

/**
 * The draw commands (TAB-5.11): numbered versions of one tab round's set of
 * fixtures, `draft` or `published` (aggregate `draw`). A version is made
 * only when the set of fixtures changes; a re-pairing is a new fixture and
 * the old one is withdrawn at publish.
 */

const forceKeyNames = Object.keys(forceKeys) as [ForceKey, ...ForceKey[]];
export const forceKeySchema = z.enum(forceKeyNames);

/** The draw's seed: 32 bytes as lowercase hex, kept in its inputs record. */
const seedSchema = z.string().regex(/^[0-9a-f]{64}$/);

const distinct = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** One typed change to a draft; a fixture an edit changes is replaced by a new one. */
export const drawEditSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('move-entry'),
    entryId: idSchema,
    toFixtureId: idSchema,
    /** The place in the target fixture, in its side or speaker order. */
    position: z.int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('swap-sides'), fixtureId: idSchema }),
  z.strictObject({
    type: z.literal('add-fixture'),
    kind: z.enum(['pairing', 'section']),
    /** In side or speaker order. */
    entryIds: z
      .array(idSchema)
      .min(2)
      .refine(distinct, 'An entry is placed once'),
  }),
  z.strictObject({ type: z.literal('remove-fixture'), fixtureId: idSchema }),
  z.strictObject({ type: z.literal('set-bye'), entryId: idSchema }),
]);
export type DrawEdit = z.infer<typeof drawEditSchema>;

/**
 * A rule the host chose to break for this one draw. The reason is a string
 * that must be given; a blank one is refused `reason-required`.
 */
export const drawOverrideSchema = z.strictObject({
  key: forceKeySchema,
  reason: z.string().max(500),
});
export type DrawOverride = z.infer<typeof drawOverrideSchema>;

export const drawCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('generate-draw'),
    tabRoundId: idSchema,
    /** Results count through this tab round number; 0 counts none. */
    resultCutoff: z.int().nonnegative(),
    seed: seedSchema,
  }),
  z.strictObject({ type: z.literal('assign-judges'), drawId: idSchema }),
  z.strictObject({
    type: z.literal('edit-draw'),
    basedOnDrawId: idSchema,
    edits: z.array(drawEditSchema).min(1).max(200),
  }),
  z.strictObject({
    type: z.literal('publish-draw'),
    drawId: idSchema,
    overrides: z
      .array(drawOverrideSchema)
      .max(forceKeyNames.length)
      .refine(
        (overrides) => distinct(overrides.map((override) => override.key)),
        'A rule is overridden once',
      ),
  }),
  z.strictObject({ type: z.literal('discard-draft'), drawId: idSchema }),
]);
export type DrawCommand = z.infer<typeof drawCommandSchema>;

export const drawRefusals = [
  'stale-draft',
  'inputs-changed',
  'rule-unsatisfiable',
  'draw-unresolved',
  'results-incomplete',
  'settings-incomplete',
  'choices-pending',
  'judges-insufficient',
  'judge-double-booked',
  'fixture-started',
  'draw-unchanged',
  'rule-broken',
  'reason-required',
  'slot-clash',
  'slot-unset',
] as const;
export type DrawRefusal = (typeof drawRefusals)[number];
export const drawRefusalSchema = z.enum(drawRefusals);

const onDraw = { aggregate: 'draw', history: 'entry' } as const;

export const drawCommandCatalogue = {
  'generate-draw': {
    ...onDraw,
    gate: ['tournament.draw.edit'],
    versions: ['draw', 'entries', 'settings', 'results'],
    refusals: [
      'rule-unsatisfiable',
      'draw-unresolved',
      'results-incomplete',
      'settings-incomplete',
      'choices-pending',
      'draw-unchanged',
    ],
  },
  'assign-judges': {
    ...onDraw,
    gate: ['tournament.draw.edit', 'tournament.rooms.officiate'],
    versions: ['draw', 'timeSlot'],
    refusals: [
      'judges-insufficient',
      'judge-double-booked',
      'settings-incomplete',
    ],
  },
  'edit-draw': {
    ...onDraw,
    gate: ['tournament.draw.edit'],
    versions: ['draw'],
    refusals: ['stale-draft', 'fixture-started'],
  },
  'publish-draw': {
    ...onDraw,
    gate: ['tournament.draw.publish'],
    versions: ['draw', 'entries', 'timeSlot'],
    refusals: [
      'stale-draft',
      'inputs-changed',
      'rule-broken',
      'reason-required',
      'fixture-started',
      'draw-unchanged',
      'judge-double-booked',
      'slot-clash',
      'slot-unset',
    ],
  },
  'discard-draft': {
    ...onDraw,
    gate: ['tournament.draw.edit'],
    versions: ['draw'],
    refusals: ['stale-draft'],
  },
} as const satisfies LobbyCommandCatalogue<DrawCommand>;

export const drawCommandEnvelopeSchema =
  lobbyCommandEnvelope(drawCommandSchema);
