import { z } from 'zod';
import { tabRoundHostViewSchema } from './tab-round-read';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import {
  drawMethods,
  drawStatuses,
  fixtureKinds,
  fixtureStatuses,
} from './vocabulary';

/**
 * The host's reads of a draw (TAB-5.13): one version of a tab round's
 * fixtures as the engine made it, and the published draws that used a result
 * a correction has since superseded. Neither offers to recompute anything.
 */

const name = z.string().trim().min(1).max(200);
/** Words the tab engine wrote; a projection shows them as they are. */
const engineText = z.string().trim().min(1).max(2000);
const instant = z.iso.datetime();

/** How much a finding weighs: a broken rule is never relaxed. */
const drawFindingSeverities = [
  'note',
  'preference_bent',
  'rule_broken',
] as const;
export type DrawFindingSeverity = (typeof drawFindingSeverities)[number];

const drawFinding = z.strictObject({
  severity: z.enum(drawFindingSeverities),
  text: engineText,
});

const drawEntry = z.strictObject({
  school: name.nullable(),
  entryId: idSchema,
  name,
  /** The side the format names, or null where the format has none. */
  side: name.nullable(),
});

const drawJudge = z.strictObject({
  tournamentJudgeId: idSchema,
  name,
  chair: z.boolean(),
});

/** A different pairing the engine weighed, and what it would cost. */
const drawAlternative = z.strictObject({
  change: engineText,
  cost: engineText,
  /** The name of a rule it breaks, which publishing it must override. */
  breaksRule: name.nullable(),
});

const drawFixture = z.strictObject({
  fixtureId: idSchema,
  kind: z.enum(fixtureKinds),
  status: z.enum(fixtureStatuses),
  /** In position order. */
  entries: z.array(drawEntry).min(1),
  judges: z.array(drawJudge),
  findings: z.array(drawFinding),
  /** The engine's account of why it made this fixture. */
  reasons: z.array(engineText),
  alternative: drawAlternative.nullable(),
});

/** The engine pairing record, with its exact value and format-specific label. */
const recordGroup = z.strictObject({
  record: z.strictObject({
    label: name,
    value: z.strictObject({ n: z.int(), d: z.int().positive() }),
  }),
  fixtures: z.array(drawFixture),
});

export const drawViewSchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  tabRound: z.strictObject({
    tabRoundId: idSchema,
    number: z.int().min(1),
  }),
  draw: z.strictObject({
    drawId: idSchema,
    version: z.int().min(1),
    status: z.enum(drawStatuses),
    method: z.enum(drawMethods),
    publishedAt: instant.nullable(),
    basedOn: z
      .strictObject({ drawId: idSchema, version: z.int().min(1) })
      .nullable(),
  }),
  /** The format's sides, in seat order. */
  sides: z.array(name),
  /** The last tab round whose results it was drawn from; null for a first round. */
  resultsThroughRound: z.int().min(1).nullable(),
  recordGroups: z.array(recordGroup),
  /** Judges free in the tab round's time slot, who a seat may be given to. */
  spareJudges: z.array(z.strictObject({ tournamentJudgeId: idSchema, name })),
  capabilities: z.strictObject({ edit: z.boolean(), publish: z.boolean() }),
});
export type DrawView = z.infer<typeof drawViewSchema>;
export type DrawViewFixture = z.infer<typeof drawFixture>;

/**
 * One published draw that used a result a correction later superseded: the
 * draw stands as published, and nothing here offers to recompute it.
 */
const supersededInput = z.strictObject({
  draw: z.strictObject({
    drawId: idSchema,
    tabRoundId: idSchema,
    tabRoundNumber: z.int().min(1),
    version: z.int().min(1),
    publishedAt: instant,
  }),
  result: z.strictObject({
    resultId: idSchema,
    fixtureId: idSchema,
    tabRoundNumber: z.int().min(1),
    recordedAt: instant,
  }),
  correction: z.strictObject({
    resultId: idSchema,
    supersedesResultId: idSchema,
    reason: engineText,
    recordedAt: instant,
  }),
});

export const supersededInputListSchema = z
  .strictObject({
    lobbyId: idSchema,
    eventId: idSchema,
    items: z.array(supersededInput),
  })
  .refine(
    (list) =>
      list.items.every(
        (item) => item.correction.supersedesResultId === item.result.resultId,
      ),
    {
      message: 'A correction supersedes the result the draw used.',
      path: ['items'],
    },
  );

export const drawReadCatalogue = {
  DrawView: { gate: ['lobby.host.draw.read'] },
  SupersededInputList: { gate: ['lobby.host.draw.read'] },
} as const satisfies LobbyReadCatalogue<'DrawView' | 'SupersededInputList'>;

/** Search and paging are applied before the screen receives its read. */
export const drawQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(''),
  offset: z.int().nonnegative().default(0),
  pageSize: z.int().min(1).max(500).default(100),
});

/** Current command guards sampled with the addressed draw's retained sources. */
const hostDrawGuardsSchema = z.strictObject({
  draw: z.int().positive().nullable(),
  entries: z.int().positive(),
  settings: z.int().positive(),
  results: z.int().positive(),
  timeSlot: z.int().positive().nullable(),
});
const hostRoundAddress = {
  lobbyId: idSchema,
  eventId: idSchema,
  tabRound: z.strictObject({
    tabRoundId: idSchema,
    number: z.int().positive(),
    name: name.nullable(),
  }),
  guards: hostDrawGuardsSchema,
  capabilities: z.strictObject({ generate: z.boolean() }),
};
export const hostRoundViewSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ ...hostRoundAddress, kind: z.literal('undrawn') }),
    z.strictObject({
      ...hostRoundAddress,
      kind: z.literal('draft'),
      draw: drawViewSchema,
    }),
    z.strictObject({
      ...hostRoundAddress,
      kind: z.literal('published'),
      round: tabRoundHostViewSchema,
    }),
  ])
  .superRefine((view, ctx) => {
    if ((view.kind === 'undrawn') !== (view.guards.draw === null))
      ctx.addIssue({
        code: 'custom',
        path: ['guards', 'draw'],
        message: 'An absent draw has no version guard.',
      });
    if (view.kind === 'undrawn') return;
    const child = view.kind === 'draft' ? view.draw : view.round;
    const childRound = child.tabRound;
    if (
      child.lobbyId !== view.lobbyId ||
      child.eventId !== view.eventId ||
      childRound.tabRoundId !== view.tabRound.tabRoundId ||
      childRound.number !== view.tabRound.number
    )
      ctx.addIssue({
        code: 'custom',
        path: [view.kind === 'draft' ? 'draw' : 'round'],
        message: 'The read retains its addressed tournament event and round.',
      });
    if (view.kind === 'draft' && view.guards.draw !== view.draw.draw.version)
      ctx.addIssue({
        code: 'custom',
        path: ['guards', 'draw'],
        message: 'The displayed draft has its actual version guard.',
      });
  });
export type HostRoundView = z.infer<typeof hostRoundViewSchema>;
export const hostDrawOverviewSchema = z.strictObject({
  lobbyId: idSchema,
  events: z.array(
    z.strictObject({
      eventId: idSchema,
      name,
      rounds: z.array(
        z.strictObject({
          tabRoundId: idSchema,
          number: z.int().positive(),
          name: name.nullable(),
          draw: z
            .strictObject({
              drawId: idSchema,
              version: z.int().positive(),
              status: z.enum(drawStatuses),
            })
            .nullable(),
        }),
      ),
    }),
  ),
});
export type HostDrawOverview = z.infer<typeof hostDrawOverviewSchema>;
