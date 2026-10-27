import type { FormatSelectionFacts, RoomCreate } from '@daisy/protocol';
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
      recheck: null,
    };
  }
  const tuple = {
    formatId: selection.formatId,
    formatVersion: selection.formatVersion,
    presetVersion: selection.presetVersion,
  };
  const request = {
    ...tuple,
    intent:
      selection.kind === 'ranked'
        ? ('create-ranked' as const)
        : ('create-casual' as const),
    basis: null,
  };
  const decision = decideFormatSelection(
    request,
    await store.getFormatSelectionFacts(tuple),
  );
  if (!decision.ok) throw createAppError('VALIDATION', decision.refusal);
  const decided = JSON.stringify([
    decision.definition,
    decision.config,
    decision.basis,
    decision.rankedPresetVersion,
  ]);
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
    /**
     * The create transaction rereads the facts FOR SHARE and admits only an
     * identical decision, so a publication in between refuses the create.
     */
    recheck: {
      tuple,
      admits: (facts: FormatSelectionFacts | null) => {
        const again = decideFormatSelection(request, facts);
        return (
          again.ok &&
          JSON.stringify([
            again.definition,
            again.config,
            again.basis,
            again.rankedPresetVersion,
          ]) === decided
        );
      },
    },
  };
}
