import { oneOnOneRankedSettings } from '@daisy/db/reference-formats';
import { emptyRuntimeCheckpoint, freezeRoomConfig } from '@daisy/protocol';
import type {
  LaunchedRound,
  RoundLifecycle,
  RoundLifecycleColumns,
  RoundView,
} from '@daisy/protocol';
import { caller, state } from '../room-runtime/operations.test-support';

/** The stored Round its host reads; `round` is what a viewer receives. */
export const launched: LaunchedRound = {
  id: 'd4n6p8r2t4v6x8z1k3b5c7d9',
  roomId: state.id,
  version: 1,
  status: 'opening',
  ladderId: null,
  competitionType: 'casual',
  topic: state.topic ?? '',
  visibility: 'private',
  hostActorId: caller.actorId,
  hostInherited: false,
  config: freezeRoomConfig(oneOnOneRankedSettings),
  rules: state.rules,
  participants: [
    {
      id: state.participants[0]!.id,
      actorId: caller.actorId,
      kind: 'human',
      label: 'Member',
      role: 'affirmative',
      slot: 0,
    },
  ],
  startedAt: null,
  completedAt: null,
  outcome: null,
  panelRuling: null,
  platformEnding: null,
  postRoundCall: false,
  transcriptCompleteness: null,
  resolutionAudit: null,
  checkpoint: emptyRuntimeCheckpoint,
  segments: [],
};
/** The host's own reading of the launched Round. */
/** A Round view still in its opening: nothing has started. */
export type OpeningRoundView = Extract<
  RoundView,
  { readonly status: 'opening' }
>;
export const round: OpeningRoundView = (({
  hostActorId,
  hostInherited,
  ...viewed
}) => {
  void hostActorId;
  void hostInherited;
  return { ...viewed, opening: null, waitingOn: null, viewerIsHost: true };
})(launched);

/** A Round at another point in its life: its lifecycle columns replaced as one. */
export const inLifecycle = <
  V extends RoundLifecycleColumns,
  L extends RoundLifecycle,
>(
  round: V,
  lifecycle: L,
): Omit<V, keyof RoundLifecycle> & L => ({ ...round, ...lifecycle });
