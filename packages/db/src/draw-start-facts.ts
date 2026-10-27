import { and, desc, eq, gt, isNull, lte, max, or } from 'drizzle-orm';
import type { DrawBankSnapshot, RoomAssemblyState } from '@daisy/protocol';
import {
  resolutionBankEntries,
  resolutionBankRevisions,
} from './schema/resolution-draws';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import type { Tx } from './room-command-facts';

/** Rounds per seated human whose chosen bank entries a new draw excludes. */
const RECENT_ROUNDS = 20;

/**
 * Facts a new draw reads, loaded only for `start-pre-round` on a draw Room:
 * the bank snapshot at its current revision and the bank entries the
 * seated humans recently debated. The engine decides exclusion with them.
 */
export const drawStartFacts = async (
  tx: Tx,
  state: RoomAssemblyState,
): Promise<{
  readonly bank: DrawBankSnapshot | null;
  readonly exclusions: readonly string[];
}> => {
  const draw = state.executionPlan.resolutionDraw;
  if (!draw.enabled || draw.source.kind !== 'bank')
    return { bank: null, exclusions: [] };
  const bank = await bankSnapshot(tx);
  if (!bank) return { bank: null, exclusions: [] };
  return { bank, exclusions: await recentChoices(tx, state) };
};

/** The bank at its newest revision, or null before any is published. */
const bankSnapshot = async (tx: Tx): Promise<DrawBankSnapshot | null> => {
  const [latest] = await tx
    .select({ revision: max(resolutionBankRevisions.revision) })
    .from(resolutionBankRevisions);
  const revision = latest?.revision ?? null;
  if (revision === null) return null;
  const entries = await tx
    .select({
      id: resolutionBankEntries.id,
      text: resolutionBankEntries.text,
      category: resolutionBankEntries.category,
      locale: resolutionBankEntries.locale,
    })
    .from(resolutionBankEntries)
    .where(
      and(
        lte(resolutionBankEntries.addedInRevision, revision),
        or(
          isNull(resolutionBankEntries.retiredInRevision),
          gt(resolutionBankEntries.retiredInRevision, revision),
        ),
      ),
    );
  return { revision, entries };
};

/** Bank entries chosen in each seated human's recent Rounds. */
const recentChoices = async (tx: Tx, state: RoomAssemblyState) => {
  const humans = state.participants
    .filter((p) => p.kind === 'human')
    .map((p) => p.actorId);
  const exclusions = new Set<string>();
  for (const actorId of humans) {
    const recent = await tx
      .select({ evidence: rounds.resolutionEvidence })
      .from(roundParticipants)
      .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
      .where(eq(roundParticipants.actorId, actorId))
      .orderBy(desc(rounds.createdAt))
      .limit(RECENT_ROUNDS);
    for (const { evidence } of recent) {
      const chosen = evidence?.items.find(
        (i) => i.position === evidence.survivorPosition,
      )?.bankEntryId;
      if (chosen) exclusions.add(chosen);
    }
  }
  return [...exclusions];
};
