import {
  idle,
  refused,
  unacknowledged,
} from '../../../features/forms/form-state';
import {
  BallotCommandForm,
  type BallotAuthoringAction,
} from './ballot-command-form';
import { BallotDefinitionFields } from './ballot-definition-fields';
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
export const refusedPublish: BallotAuthoringAction = async (_previous, form) =>
  refused(form, 'This ballot changed. Review it and publish again.');

/** A publish whose answer is lost on the way back. */
export const unacknowledgedPublish: BallotAuthoringAction = async (
  _previous,
  form,
) => unacknowledged(form);

/** The stored event's ballot editor as its page mounts it. */
export function EditorHarness({
  view,
  publish = action,
}: {
  readonly view: EventBallotAuthoringView;
  readonly publish?: BallotAuthoringAction;
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

/** The definition fields alone in their command form, with no editor around them. */
export function FieldsHarness({
  view,
  publish = action,
}: {
  readonly view: EventBallotAuthoringView;
  readonly publish?: BallotAuthoringAction;
}) {
  return (
    <WithAppRouter>
      <BallotCommandForm
        action={publish}
        label="Publish ballot definition"
        submitLabel="Publish definition"
      >
        <BallotDefinitionFields view={view} />
      </BallotCommandForm>
    </WithAppRouter>
  );
}
