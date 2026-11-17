import { idle } from '../../../features/forms/form-state';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { WithAppRouter } from '../../test-support/app-router';
import { BallotAuthoringEditor } from './ballot-authoring-editor';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';
export {
  authoringView,
  leagueDefinitionId,
} from '../../../features/tab/ballot-preview-source.test-support';

const action = async () => idle();

/** The stored event's ballot editor as its page mounts it. */
export function EditorHarness({
  view,
}: {
  readonly view: EventBallotAuthoringView;
}) {
  return (
    <WithAppRouter>
      <BallotAuthoringEditor
        view={view}
        saved={null}
        publish={action}
        pin={action}
        screening={action}
      />
    </WithAppRouter>
  );
}
