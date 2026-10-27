import type { RoomCreate } from '@daisy/protocol';
import {
  decideFormatSelection,
  resolveRoomConfiguration,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { IdGenerator } from '@daisy/clock';
import type { Store } from './operations';

/**
 * What a create body selects, decided by the one selection policy (FMT-1):
 * a catalog format at its canonical preset, ranked play at an eligible
 * preset, or a private custom definition. The client never supplies a
 * catalog config or a basis.
 */
export async function resolveRoomSelection(
  body: RoomCreate,
  store: Pick<Store, 'getFormatSelectionFacts'>,
  ids: IdGenerator,
) {
  const selection = body.selection;
  if (selection.kind === 'custom') {
    const resolved = resolveRoomConfiguration(
      selection.definition,
      selection.config,
    );
    if (!resolved.ok) throw createAppError('VALIDATION', resolved.refusal.kind);
    return {
      selection,
      definition: selection.definition,
      config: selection.config,
      formatId: ids.next(),
      formatVersion: 1,
      presetVersion: null,
      basis: null,
      competitionType: selection.competitionType,
      resolved,
    };
  }
  const tuple = {
    formatId: selection.formatId,
    formatVersion: selection.formatVersion,
    presetVersion: selection.presetVersion,
  };
  const decision = decideFormatSelection(
    {
      ...tuple,
      intent: selection.kind === 'ranked' ? 'create-ranked' : 'create-casual',
      basis: null,
    },
    await store.getFormatSelectionFacts(tuple),
  );
  if (!decision.ok) throw createAppError('VALIDATION', decision.refusal);
  return {
    selection,
    definition: decision.definition,
    config: decision.config,
    formatId: selection.formatId,
    formatVersion: selection.formatVersion,
    presetVersion: decision.rankedPresetVersion,
    basis: decision.basis,
    competitionType:
      selection.kind === 'ranked' ? ('ranked' as const) : ('casual' as const),
    resolved: decision.resolved,
  };
}
