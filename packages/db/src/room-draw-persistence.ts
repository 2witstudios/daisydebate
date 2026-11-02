import { and, asc, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  roundDrawPrivateInputs,
  roundDrawSeeds,
  roundResolutionDrawItems,
  roundResolutionDrawTexts,
  roundResolutionDraws,
  roundResolutionStrikes,
} from './schema/resolution-draws';
import type { Tx } from './room-command-facts';
import type {
  DrawPrivateInputs,
  ResolutionAudit,
  ResolutionDrawEvidence,
  ResolutionDrawState,
} from '@daisy/protocol/resolution-draw';

/** A Round's draw as the engine reads it, plus its secret seed (hex). */
export const loadRoundDraw = async (
  tx: Pick<Tx, 'select'>,
  roundId: string,
): Promise<{
  readonly state: ResolutionDrawState;
  readonly seed: string;
} | null> => {
  const [draw] = await tx
    .select()
    .from(roundResolutionDraws)
    .where(eq(roundResolutionDraws.roundId, roundId));
  if (!draw) return null;
  const [seed] = await tx
    .select({ seed: roundDrawSeeds.seed })
    .from(roundDrawSeeds)
    .where(eq(roundDrawSeeds.roundId, roundId));
  if (!seed) throw createAppError('INVARIANT');
  const items = await tx
    .select({
      position: roundResolutionDrawItems.position,
      candidateId: roundResolutionDrawItems.candidateId,
      category: roundResolutionDrawItems.category,
      text: roundResolutionDrawTexts.text,
    })
    .from(roundResolutionDrawItems)
    .innerJoin(
      roundResolutionDrawTexts,
      and(
        eq(roundResolutionDrawTexts.roundId, roundId),
        eq(
          roundResolutionDrawTexts.position,
          roundResolutionDrawItems.position,
        ),
      ),
    )
    .where(eq(roundResolutionDrawItems.drawId, draw.id))
    .orderBy(asc(roundResolutionDrawItems.position));
  const strikes = await tx
    .select()
    .from(roundResolutionStrikes)
    .where(eq(roundResolutionStrikes.drawId, draw.id))
    .orderBy(asc(roundResolutionStrikes.ordinal));
  return {
    seed: seed.seed,
    state: {
      id: draw.id,
      manifest: draw.manifest,
      manifestDigest: draw.manifestDigest,
      commitment: draw.commitment,
      startedAt: draw.startedAt.toISOString(),
      items,
      strikes: strikes.map((s) => ({
        ordinal: s.ordinal,
        position: s.position,
        side: s.side,
        kind: s.kind,
        actorId: s.actorId,
        commandId: s.commandId,
        at: s.struckAt.toISOString(),
      })),
    },
  };
};

/** The draw a Start round creates, with its seed, texts and private inputs. */
export const insertRoundDraw = async (
  tx: Tx,
  roundId: string,
  draw: {
    readonly state: ResolutionDrawState;
    readonly seed: string;
    readonly inputs: DrawPrivateInputs;
  },
) => {
  const { state, seed, inputs } = draw;
  const sourceKind = state.manifest.source.kind;
  const drawSize = state.manifest.drawSize;
  await tx.insert(roundResolutionDraws).values({
    id: state.id,
    roundId,
    sourceKind,
    drawSize,
    manifest: state.manifest,
    manifestDigest: state.manifestDigest,
    commitment: state.commitment,
    startedAt: new Date(state.startedAt),
  });
  await tx.insert(roundDrawSeeds).values({ roundId, seed });
  await tx.insert(roundDrawPrivateInputs).values({ roundId, inputs });
  await tx.insert(roundResolutionDrawItems).values(
    state.items.map((item) => ({
      drawId: state.id,
      position: item.position,
      sourceKind,
      drawSize,
      candidateId: item.candidateId,
      bankEntryId: sourceKind === 'bank' ? item.candidateId : null,
      category: item.category,
    })),
  );
  await tx
    .insert(roundResolutionDrawTexts)
    .values(
      state.items.map((i) => ({ roundId, position: i.position, text: i.text })),
    );
};

/** Appends a settled draw's new strikes; drawn rows are never updated. */
export const appendRoundStrikes = async (
  tx: Pick<Tx, 'insert'>,
  draw: ResolutionDrawState,
  stored: number,
) => {
  const added = draw.strikes.slice(stored);
  if (added.length)
    await tx.insert(roundResolutionStrikes).values(
      added.map((s) => ({
        drawId: draw.id,
        ordinal: s.ordinal,
        position: s.position,
        drawSize: draw.manifest.drawSize,
        side: s.side,
        kind: s.kind,
        actorId: s.actorId,
        commandId: s.commandId,
        struckAt: new Date(s.at),
      })),
    );
  return added.length;
};

/** The strikes a draw has stored, without loading it. */
export const storedStrikeCount = async (
  tx: Pick<Tx, 'select'>,
  drawId: string,
) => {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(roundResolutionStrikes)
    .where(eq(roundResolutionStrikes.drawId, drawId));
  return row?.count ?? 0;
};

/** The revealed draw's proof metadata, written to the Round at the reveal. */
export const revealEvidence = (
  draw: ResolutionDrawState,
): ResolutionDrawEvidence & { readonly survivorText: string } => {
  const struck = new Set(draw.strikes.map((s) => s.position));
  const survivor = draw.items.find((i) => !struck.has(i.position));
  if (!survivor || draw.strikes.length !== draw.manifest.drawSize - 1)
    throw createAppError('INVARIANT');
  return {
    version: 1,
    manifest: draw.manifest,
    manifestDigest: draw.manifestDigest,
    commitment: draw.commitment,
    startedAt: draw.startedAt,
    items: draw.items.map((i) => ({
      position: i.position,
      category: i.category,
      bankEntryId: draw.manifest.source.kind === 'bank' ? i.candidateId : null,
    })),
    strikes: draw.strikes.map(({ ordinal, side, kind, position, at }) => ({
      ordinal,
      side,
      kind,
      position,
      at,
    })),
    survivorPosition: survivor.position,
    revealedAt: draw.strikes.at(-1)!.at,
    survivorText: survivor.text,
  };
};

/**
 * The public draw envelope of an ended Round (ADR 0076): proof metadata,
 * the drawn texts that survive erasure and whether the private inputs do.
 * Never the seed. Null for a live Round or one without a draw.
 */
export const roundResolutionAudit = async (
  tx: Pick<Tx, 'select'>,
  round: {
    readonly id: string;
    readonly status: string;
    readonly resolutionEvidence: ResolutionDrawEvidence | null;
  },
): Promise<ResolutionAudit | null> => {
  const evidence = round.resolutionEvidence;
  if (
    !evidence ||
    (round.status !== 'completed' && round.status !== 'abandoned')
  )
    return null;
  const texts = await tx
    .select()
    .from(roundResolutionDrawTexts)
    .where(eq(roundResolutionDrawTexts.roundId, round.id));
  const [inputs] = await tx
    .select({ roundId: roundDrawPrivateInputs.roundId })
    .from(roundDrawPrivateInputs)
    .where(eq(roundDrawPrivateInputs.roundId, round.id));
  return {
    manifest: evidence.manifest,
    manifestDigest: evidence.manifestDigest,
    commitment: evidence.commitment,
    items: evidence.items.map(({ position, category }) => ({
      position,
      category,
      text: texts.find((t) => t.position === position)?.text ?? null,
    })),
    strikes: evidence.strikes,
    survivorPosition: evidence.survivorPosition,
    revealedAt: evidence.revealedAt,
    inputsErased: !inputs,
    textsWithheld: false,
  };
};
