import { oneOnOneRankedSettings } from '@daisy/db/reference-formats';
import { emptyRuntimeCheckpoint, freezeRoomConfig } from '@daisy/protocol';
import type { LaunchedRound, RoundView } from '@daisy/protocol';
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
  transcriptCompleteness: null,
  resolutionAudit: null,
  checkpoint: emptyRuntimeCheckpoint,
  segments: [],
};
/** The host's own reading of the launched Round. */
export const round: RoundView = (({
  hostActorId,
  hostInherited,
  ...viewed
}) => {
  void hostActorId;
  void hostInherited;
  return { ...viewed, opening: null, waitingOn: null, viewerIsHost: true };
})(launched);
