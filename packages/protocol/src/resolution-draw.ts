import { z } from 'zod';
import { debateSideSchema, idSchema } from './primitives';

/**
 * The pre-round resolution draw (FMT-7): the debaters strike alternately
 * from a drawn set until one resolution is left. Two sides, alternating
 * turns and one survivor are contract assumptions, not modes.
 */
export const resolutionCategories = ['policy', 'value', 'fact'] as const;
export const resolutionCategorySchema = z.enum(resolutionCategories);
export type ResolutionCategory = (typeof resolutionCategories)[number];

export const drawSources = ['bank', 'host'] as const;

/** One host-written resolution: trimmed, 1–300 characters. */
const hostResolutionSchema = z.string().trim().min(1).max(300);

/** A host list: 2–20 lines, unique ignoring case. Order is the author's. */
const hostResolutionsSchema = z
  .array(hostResolutionSchema)
  .min(2)
  .max(20)
  .refine(
    (lines) =>
      new Set(lines.map((line) => line.toLocaleLowerCase())).size ===
      lines.length,
    'Resolutions must be unique',
  );

const categoriesSchema = z
  .array(resolutionCategorySchema)
  .min(1)
  .refine(
    (categories) => new Set(categories).size === categories.length,
    'Categories must be unique',
  );

/** Internal: the source as the host chose it. */
const drawSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bank'), categories: categoriesSchema }),
  z.strictObject({
    kind: z.literal('host'),
    resolutions: hostResolutionsSchema,
  }),
]);

/** Public and frozen: a host list is only its length. */
const frozenDrawSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bank'), categories: categoriesSchema }),
  z.strictObject({
    kind: z.literal('host'),
    count: z.int().min(2).max(20),
  }),
]);

const drawChoice = {
  enabled: z.literal(true),
  drawSize: z.int().min(2).max(20),
  strikeWindowMs: z.int().positive(),
  firstStriker: debateSideSchema,
};
const declined = z.strictObject({ enabled: z.literal(false) });

const sourceCoversDraw = (draw: {
  readonly enabled: boolean;
  readonly drawSize?: number;
  readonly source?:
    | { readonly kind: 'bank' }
    | { readonly kind: 'host'; readonly resolutions: readonly string[] };
}) =>
  !draw.enabled ||
  draw.source?.kind !== 'host' ||
  draw.source.resolutions.length >= (draw.drawSize ?? 0);

/** The Room's draw choice (internal: compiler, engine, persistence). */
export const roomResolutionDrawSchema = z
  .discriminatedUnion('enabled', [
    declined,
    z.strictObject({ ...drawChoice, source: drawSourceSchema }),
  ])
  .refine(sourceCoversDraw, {
    message: 'A host list needs at least as many resolutions as are drawn',
    path: ['source', 'resolutions'],
  });
export type RoomResolutionDraw = z.infer<typeof roomResolutionDrawSchema>;

/** The viewer-independent draw choice delivered and frozen onto a Round. */
export const frozenResolutionDrawSchema = z.discriminatedUnion('enabled', [
  declined,
  z.strictObject({ ...drawChoice, source: frozenDrawSourceSchema }),
]);
export type FrozenResolutionDraw = z.infer<typeof frozenResolutionDrawSchema>;

/** The one projection from the internal choice to its public shape. */
export const freezeResolutionDraw = (
  draw: RoomResolutionDraw,
): FrozenResolutionDraw =>
  !draw.enabled
    ? draw
    : {
        ...draw,
        source:
          draw.source.kind === 'bank'
            ? draw.source
            : { kind: 'host', count: draw.source.resolutions.length },
      };

export const strikeKinds = ['debater', 'timeout', 'automatic'] as const;
export const strikeKindSchema = z.enum(strikeKinds);
export const sideControllers = ['human', 'automatic'] as const;
const sideControllersSchema = z.strictObject({
  affirmative: z.enum(sideControllers),
  negative: z.enum(sideControllers),
});

const timestamp = z.iso.datetime({ offset: true });
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

const publicStrikeSchema = z.strictObject({
  ordinal: z.int().min(0),
  side: debateSideSchema,
  kind: strikeKindSchema,
});
const turnSchema = z
  .strictObject({
    ordinal: z.int().min(0),
    side: debateSideSchema,
    dueAt: timestamp,
  })
  .nullable();

/**
 * What a viewer sees of a draw. Seated debaters see every drawn text;
 * everyone else sees only progress. A revealed survivor reaches everyone
 * through the Room's topic, never through this field.
 */
export const resolutionDrawViewSchema = z.discriminatedUnion('visibility', [
  z.strictObject({
    visibility: z.literal('debater'),
    commitment: digestSchema,
    drawSize: z.int().min(2),
    items: z
      .array(
        z.strictObject({
          position: z.int().min(0),
          text: z.string().min(1),
          category: resolutionCategorySchema.nullable(),
        }),
      )
      .readonly(),
    strikes: z
      .array(publicStrikeSchema.extend({ position: z.int().min(0) }))
      .readonly(),
    turn: turnSchema,
    revealedAt: timestamp.nullable(),
  }),
  z.strictObject({
    visibility: z.literal('progress'),
    drawSize: z.int().min(2),
    strikes: z.array(publicStrikeSchema).readonly(),
    turn: turnSchema,
    revealedAt: timestamp.nullable(),
  }),
]);
export type ResolutionDrawView = z.infer<typeof resolutionDrawViewSchema>;

/** The bank filters a draw read: its revision and v1's fixed policy. */
const bankSourceSchema = z.strictObject({
  kind: z.literal('bank'),
  revision: z.int().positive(),
  categories: categoriesSchema,
  locale: z.literal('en'),
  difficulties: z.tuple([
    z.literal('advanced'),
    z.literal('intro'),
    z.literal('standard'),
  ]),
});

/** A bank snapshot the adapter loads for a new draw; the engine filters it. */
export type DrawBankSnapshot = {
  readonly revision: number;
  readonly entries: readonly {
    readonly id: string;
    readonly text: string;
    readonly category: ResolutionCategory;
    readonly locale: string;
  }[];
};

/**
 * The public draw manifest, version 1: proof metadata only. It carries no
 * unsalted digest and no count of private inputs, so guessed pools cannot
 * be checked against it.
 */
export const resolutionDrawManifestSchema = z.strictObject({
  version: z.literal(1),
  algorithm: z.literal('daisy-draw-v1'),
  roomId: idSchema,
  drawId: idSchema,
  source: z.discriminatedUnion('kind', [
    bankSourceSchema,
    z.strictObject({ kind: z.literal('host'), count: z.int().min(2).max(20) }),
  ]),
  drawSize: z.int().min(2).max(20),
  firstStriker: debateSideSchema,
  strikeWindowMs: z.int().positive(),
  controllers: sideControllersSchema,
  inputCommitment: digestSchema,
});
export type ResolutionDrawManifest = z.infer<
  typeof resolutionDrawManifestSchema
>;
export type SideControllers = z.infer<typeof sideControllersSchema>;

/** One drawn item, internal. */
export type ResolutionDrawItem = {
  readonly position: number;
  readonly candidateId: string;
  readonly text: string;
  readonly category: ResolutionCategory | null;
};

/** One recorded strike, internal. */
export type ResolutionStrike = {
  readonly ordinal: number;
  readonly position: number;
  readonly side: 'affirmative' | 'negative';
  readonly kind: (typeof strikeKinds)[number];
  readonly actorId: string | null;
  readonly commandId: string | null;
  readonly at: string;
};

/**
 * The draw as the engine reads it. The seed and private inputs never ride
 * here: they reach settlement as a separate argument.
 */
export type ResolutionDrawState = {
  readonly id: string;
  readonly manifest: ResolutionDrawManifest;
  readonly manifestDigest: string;
  readonly commitment: string;
  readonly items: readonly ResolutionDrawItem[];
  readonly startedAt: string;
  readonly strikes: readonly ResolutionStrike[];
};

/** A candidate the adapter loaded for a draw. */
export type ResolutionCandidate = {
  readonly id: string;
  readonly text: string;
  readonly category: ResolutionCategory | null;
};

const hexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The canonical source a draw read: the bank's filters, or the host's list. */
const drawSourceInputSchema = z.discriminatedUnion('kind', [
  bankSourceSchema,
  z.strictObject({
    kind: z.literal('host'),
    resolutions: hostResolutionsSchema,
  }),
]);

/**
 * Everything the draw's input commitment covers, kept private and erasable:
 * the candidate pool and exclusions reveal the players' recent history.
 */
export const drawPrivateInputsSchema = z.strictObject({
  candidateIds: z.array(z.string().min(1)).readonly(),
  exclusions: z.array(z.string().min(1)).readonly(),
  exclusionsRelaxed: z.boolean(),
  sourceInput: drawSourceInputSchema,
  configInput: z.strictObject({ ...drawChoice, source: drawSourceSchema }),
  /** 32 bytes, lowercase hex. */
  salt: hexSchema,
});
export type DrawPrivateInputs = z.infer<typeof drawPrivateInputsSchema>;

/**
 * The proof metadata frozen onto a Round at Launch: no text, no seed and no
 * private input, so it never needs rewriting when content is erased.
 */
export const resolutionDrawEvidenceSchema = z.strictObject({
  version: z.literal(1),
  manifest: resolutionDrawManifestSchema,
  manifestDigest: digestSchema,
  commitment: digestSchema,
  startedAt: timestamp,
  items: z
    .array(
      z.strictObject({
        position: z.int().min(0),
        category: resolutionCategorySchema.nullable(),
        bankEntryId: z.string().min(1).nullable(),
      }),
    )
    .readonly(),
  strikes: z
    .array(
      publicStrikeSchema.extend({ position: z.int().min(0), at: timestamp }),
    )
    .readonly(),
  survivorPosition: z.int().min(0),
  revealedAt: timestamp,
});
export type ResolutionDrawEvidence = z.infer<
  typeof resolutionDrawEvidenceSchema
>;
