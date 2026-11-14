import { createAppError } from '@daisy/errors';
import type { RoomAssemblyState } from '@daisy/protocol';
import { canonicalJson, digestOf } from '@daisy/seeded-random';
import { bytesOf, drawCommitment, inputCommitment } from './draw-random';
import { drawResolutions, sideControllers } from './resolution-draw';
import type {
  DrawBankSnapshot,
  DrawPrivateInputs,
  ResolutionDrawManifest,
  ResolutionDrawState,
} from '@daisy/protocol/resolution-draw';

/** Facts the adapter loads for a new draw; the engine decides with them. */
export type DrawStartFacts = {
  readonly drawId: string;
  readonly seed: string;
  readonly salt: string;
  /** The bank snapshot at its current revision; null for a host list. */
  readonly bank: DrawBankSnapshot | null;
  /** Bank entries chosen in the seated humans' recent Rounds. */
  readonly exclusions: readonly string[];
};

type EnabledDraw = Extract<
  RoomAssemblyState['executionPlan']['resolutionDraw'],
  { enabled: true }
>;

const DIFFICULTIES: ['advanced', 'intro', 'standard'] = [
  'advanced',
  'intro',
  'standard',
];

/** The candidates, exclusions and canonical source a draw reads, or null. */
const drawSource = (draw: EnabledDraw, facts: DrawStartFacts | null) => {
  if (!facts) return null;
  if (draw.source.kind === 'host')
    return {
      candidates: draw.source.resolutions.map((text, i) => ({
        id: `h:${i}`,
        text,
        category: null,
      })),
      exclusions: [],
      sourceInput: {
        kind: 'host' as const,
        resolutions: draw.source.resolutions,
      },
    };
  const { bank } = facts;
  if (!bank) return null;
  const categories = draw.source.categories;
  return {
    candidates: bank.entries
      .filter((e) => e.locale === 'en' && categories.includes(e.category))
      .map(({ id, text, category }) => ({ id, text, category })),
    exclusions: facts.exclusions,
    sourceInput: {
      kind: 'bank' as const,
      revision: bank.revision,
      categories: [...categories].sort(),
      locale: 'en' as const,
      difficulties: DIFFICULTIES,
    },
  };
};

/**
 * The draw a Start round creates with its Round, or null when its source
 * cannot supply one. Every strike happens after this, on the Round.
 */
export function startRoundDraw(
  room: RoomAssemblyState,
  edges: { readonly now: string; readonly drawStart: DrawStartFacts | null },
): {
  readonly state: ResolutionDrawState;
  readonly seed: string;
  readonly inputs: DrawPrivateInputs;
} | null {
  const draw = room.executionPlan.resolutionDraw;
  if (!draw.enabled)
    throw createAppError('INVARIANT', 'A draw requires an enabled plan');
  const facts = edges.drawStart;
  const source = drawSource(draw, facts);
  if (!facts || !source) return null;
  const seed = bytesOf(facts.seed);
  const drawn = drawResolutions({
    candidates: source.candidates,
    exclusions: source.exclusions,
    size: draw.drawSize,
    seed,
  });
  if (!drawn.ok) return null;
  const { sourceInput } = source;
  const committed = {
    candidateIds: drawn.candidateIds,
    exclusions: drawn.exclusions,
    exclusionsRelaxed: drawn.exclusionsRelaxed,
    sourceInput,
    configInput: draw,
  };
  const manifest: ResolutionDrawManifest = {
    version: 1,
    algorithm: 'daisy-draw-v1',
    roomId: room.id,
    drawId: facts.drawId,
    source:
      sourceInput.kind === 'bank'
        ? sourceInput
        : { kind: 'host', count: sourceInput.resolutions.length },
    drawSize: draw.drawSize,
    firstStriker: draw.firstStriker,
    strikeWindowMs: draw.strikeWindowMs,
    controllers: sideControllers(room.participants),
    inputCommitment: inputCommitment(
      bytesOf(facts.salt),
      canonicalJson(committed),
    ),
  };
  const manifestDigest = digestOf(canonicalJson(manifest));
  return {
    state: {
      id: facts.drawId,
      manifest,
      manifestDigest,
      commitment: drawCommitment({
        roomId: room.id,
        drawId: facts.drawId,
        manifestDigest,
        seed,
      }),
      items: drawn.items,
      startedAt: edges.now,
      strikes: [],
    },
    seed: facts.seed,
    inputs: { ...committed, salt: facts.salt },
  };
}
