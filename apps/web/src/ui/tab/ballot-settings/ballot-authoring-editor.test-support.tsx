import { idle, refused } from '../../../features/forms/form-state';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { WithAppRouter } from '../../test-support/app-router';
import { BallotAuthoringEditor } from './ballot-authoring-editor';

export { act, createElement } from 'react';
export { createRoot, hydrateRoot } from 'react-dom/client';
export { renderToString } from 'react-dom/server';
export {
  authoringView,
  leagueDefinitionId,
  leagueGridBallot,
} from '../../../features/tab/ballot-preview-source.test-support';

const action = async () => idle();

/** A publish the server refuses, as an envelope conflict answers. */
export const refusedPublish = async (_previous: unknown, form: FormData) =>
  refused(form, 'This ballot changed. Review it and publish again.');

/** The stored event's ballot editor as its page mounts it. */
export function EditorHarness({
  view,
  publish = action,
}: {
  readonly view: EventBallotAuthoringView;
  readonly publish?: typeof action | typeof refusedPublish;
}) {
  return (
    <WithAppRouter>
      <BallotAuthoringEditor
        view={view}
        saved={null}
        publish={publish}
        pin={action}
        screening={action}
      />
    </WithAppRouter>
  );
}
