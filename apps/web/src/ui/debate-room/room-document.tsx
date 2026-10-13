'use client';

import { useMemo, type Dispatch } from 'react';
import {
  groupTranscript,
  TRANSCRIPT_ID,
} from '../../features/debate-room/transcript';
import { DocumentPane, type SaveState } from './document-pane';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';
import { TranscriptView } from './transcript-view';

/** The open files below the video: tabs, saved state, editor or transcript. */
export function RoomDocument({
  round,
  state,
  dispatch,
  onEdit,
  save,
}: {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly onEdit: ((id: string, html: string) => void) | undefined;
  readonly save: SaveState | null;
}) {
  const sections = useMemo(
    () =>
      groupTranscript(round.transcript, round.speeches, (slot) =>
        slot.side === round.self.side ? 'You' : round.opponent.name,
      ),
    [round],
  );
  const live =
    round.phase === 'opponent-speaking'
      ? (round.speeches[round.liveIndex]?.id ?? null)
      : null;
  return (
    <section
      aria-label="Document"
      className="flex room-workspace flex-1 flex-col bg-surface-raised max-narrow:rounded-t-xl"
    >
      <DocumentPane
        documents={state.documents}
        tabs={state.tabs}
        pages={state.pages}
        dispatch={dispatch}
        onEdit={onEdit}
        save={save}
      >
        {state.tabs.active === TRANSCRIPT_ID ? (
          <TranscriptView
            sections={sections}
            liveSpeechId={live}
            filter={state.transcriptFilter}
            dispatch={dispatch}
          />
        ) : null}
      </DocumentPane>
    </section>
  );
}
