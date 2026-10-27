import { asc, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  roomResolutionDrawInputs,
  roomResolutionDrawItems,
  roomResolutionDraws,
  roomResolutionStrikes,
  roundDrawPrivateInputs,
  roundDrawSeeds,
  roundResolutionDrawTexts,
} from './schema/resolution-draws';
import type { Tx } from './room-command-facts';
import type {
  DrawPrivateInputs,
  ResolutionAudit,
  ResolutionDrawEvidence,
  ResolutionDrawState,
} from '@daisy/protocol/resolution-draw';

/** The Room's draw as the engine reads it, plus its secret seed (hex). */
export const loadRoomDraw = async (
  tx: Tx,
  roomId: string,
): Promise<{
  readonly state: ResolutionDrawState;
  readonly seed: string;
} | null> => {
  const [draw] = await tx
    .select()
    .from(roomResolutionDraws)
    .where(eq(roomResolutionDraws.roomId, roomId));
  if (!draw) return null;
  const items = await tx
    .select()
    .from(roomResolutionDrawItems)
    .where(eq(roomResolutionDrawItems.drawId, draw.id))
    .orderBy(asc(roomResolutionDrawItems.position));
  const strikes = await tx
    .select()
    .from(roomResolutionStrikes)
    .where(eq(roomResolutionStrikes.drawId, draw.id))
    .orderBy(asc(roomResolutionStrikes.ordinal));
  return {
    seed: draw.seed,
    state: {
      id: draw.id,
      manifest: draw.manifest,
      manifestDigest: draw.manifestDigest,
      commitment: draw.commitment,
      startedAt: draw.startedAt.toISOString(),
      items: items.map((i) => ({
        position: i.position,
        candidateId: i.candidateId,
        text: i.text,
        category: i.category,
      })),
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

/**
 * Writes what a mutation added to the draw: the draw itself with its
 * private inputs when it was just created, then every strike after the
 * stored ones. Draw rows are never updated.
 */
export const persistRoomDraw = async (
  tx: Tx,
  roomId: string,
  next: ResolutionDrawState | null,
  storedStrikes: number,
  secrets: { readonly seed: string; readonly inputs: DrawPrivateInputs } | null,
) => {
  if (!next) return;
  const sourceKind = next.manifest.source.kind;
  const drawSize = next.manifest.drawSize;
  if (secrets) {
    await tx.insert(roomResolutionDraws).values({
      id: next.id,
      roomId,
      sourceKind,
      drawSize,
      manifest: next.manifest,
      manifestDigest: next.manifestDigest,
      commitment: next.commitment,
      seed: secrets.seed,
      startedAt: new Date(next.startedAt),
    });
    await tx
      .insert(roomResolutionDrawInputs)
      .values({ drawId: next.id, inputs: secrets.inputs });
    await tx.insert(roomResolutionDrawItems).values(
      next.items.map((item) => ({
        drawId: next.id,
        position: item.position,
        sourceKind,
        drawSize,
        candidateId: item.candidateId,
        bankEntryId: sourceKind === 'bank' ? item.candidateId : null,
        text: item.text,
        category: item.category,
      })),
    );
  }
  const added = next.strikes.slice(secrets ? 0 : storedStrikes);
  if (added.length)
    await tx.insert(roomResolutionStrikes).values(
      added.map((s) => ({
        drawId: next.id,
        ordinal: s.ordinal,
        position: s.position,
        drawSize,
        side: s.side,
        kind: s.kind,
        actorId: s.actorId,
        commandId: s.commandId,
        struckAt: new Date(s.at),
      })),
    );
};

/**
 * Launch freezes the draw onto the Round: proof metadata on the row, the
 * seed immutably, and the texts and private inputs where erasure may delete
 * them. A missing input row (erased before Launch) is a supported state.
 */
export const freezeRoomDraw = async (
  tx: Tx,
  roundId: string,
  draw: ResolutionDrawState,
): Promise<ResolutionDrawEvidence> => {
  const [stored] = await tx
    .select({ seed: roomResolutionDraws.seed })
    .from(roomResolutionDraws)
    .where(eq(roomResolutionDraws.id, draw.id));
  if (!stored) throw createAppError('INVARIANT');
  const struck = new Set(draw.strikes.map((s) => s.position));
  const survivor = draw.items.find((i) => !struck.has(i.position));
  if (!survivor || draw.strikes.length !== draw.manifest.drawSize - 1)
    throw createAppError('INVARIANT');
  await tx.insert(roundDrawSeeds).values({ roundId, seed: stored.seed });
  await tx
    .insert(roundResolutionDrawTexts)
    .values(
      draw.items.map((i) => ({ roundId, position: i.position, text: i.text })),
    );
  const [inputs] = await tx
    .select({ inputs: roomResolutionDrawInputs.inputs })
    .from(roomResolutionDrawInputs)
    .where(eq(roomResolutionDrawInputs.drawId, draw.id));
  if (inputs)
    await tx
      .insert(roundDrawPrivateInputs)
      .values({ roundId, inputs: inputs.inputs });
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
